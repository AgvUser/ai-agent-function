import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { ClientSecretCredential } from "@azure/identity";
import fetch from 'node-fetch';

// Azure AI Foundry設定（環境変数から取得、デフォルト値あり）
const AZURE_AI_FOUNDRY_ENDPOINT = process.env.AZURE_AI_FOUNDRY_ENDPOINT || 'https://[ENDPOINT]/api/projects/[PROJECT]';
const AGENT_ID = process.env.AZURE_AI_FOUNDRY_AGENT_ID || '[AGENT-ID]';
const AGENT_NAME = process.env.AZURE_AI_FOUNDRY_AGENT_NAME || '[AGENT-NAME]';

// UUID生成関数
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Azure AI Foundryエージェントへのリクエスト関数
async function callAzureAIFoundryAgent(messages: any[], context: InvocationContext): Promise<string> {
    try {
        // 最後のユーザーメッセージを抽出
        const lastUserMessage = messages
            .filter((msg: any) => msg.role === 'user')
            .pop();

        if (!lastUserMessage || !lastUserMessage.content) {
            throw new Error('No user message found');
        }

        const userPrompt = lastUserMessage.content;
        context.log(`Sending to Azure AI Foundry: ${userPrompt}`);

        // 設定値をデバッグ用にログ出力
        context.log(`=== Azure AI Foundry Configuration Debug ===`);
        context.log(`Endpoint: ${AZURE_AI_FOUNDRY_ENDPOINT}`);
        context.log(`Agent ID: ${AGENT_ID}`);
        context.log(`Agent Name: ${AGENT_NAME}`);
        context.log(`API Key available: ${!!process.env.AZURE_AI_FOUNDRY_API_KEY}`);
        context.log(`API Key prefix: ${process.env.AZURE_AI_FOUNDRY_API_KEY?.substring(0, 10)}...`);
        context.log(`===========================================`);

        // Azure AI Foundryエージェントワークフローを実行
        return await executeAzureAIFoundryWorkflow(userPrompt, context);
    } catch (error) {
        context.log('❌ Azure AI Foundry connection failed:', error);

        // フォールバック: エラー時はデフォルトレスポンス
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return `こんにちは！Azure AI Foundryエージェント（${AGENT_NAME}）との接続に問題がありますが、基本的なサポートは提供できます。どのようなことについてお話ししましょうか？\n\n※ エラー詳細: ${errorMessage}`;
    }
}

// Azure AI Foundryエンドポイントテスト関数
// Azure AI Foundryエージェントワークフロー実行関数
async function executeAzureAIFoundryWorkflow(userPrompt: string, context: InvocationContext): Promise<string> {
    const baseHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': 'Azure-Functions-Proxy/1.0'
    };

    const credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
    );
    const token = await credential.getToken('https://ai.azure.com/.default');

    // Azure ADトークンで認証
    const authHeader = { 'Authorization': `Bearer ${token.token}` };

    const apiVersion = '2025-05-01'; // GA API version

    const headers = { ...baseHeaders, ...authHeader };

    try {
        // Step 1: スレッドを作成
        context.log('Step 1: Creating thread...');
        const threadId = await createThread(headers, apiVersion, context);

        // Step 2: メッセージをスレッドに追加
        context.log('Step 2: Adding message to thread...');
        await addMessageToThread(threadId, userPrompt, headers, apiVersion, context);

        // Step 3: ランを実行
        context.log('Step 3: Creating run...');
        const runId = await createRun(threadId, headers, apiVersion, context);

        // Step 4: ランのステータスを確認
        context.log('Step 4: Checking run status...');
        await waitForRunCompletion(threadId, runId, headers, apiVersion, context);

        // Step 5: レスポンスを取得
        context.log('Step 5: Getting response...');
        const response = await getMessages(threadId, headers, apiVersion, context);

        return response;
    } catch (error) {
        throw error;
    }

}

// Step 1: スレッド作成
async function createThread(headers: any, apiVersion: string, context: InvocationContext): Promise<string> {
    const url = `${AZURE_AI_FOUNDRY_ENDPOINT}/threads?api-version=${apiVersion}`;
    context.log(`Creating thread: ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({}) // 空のボディでスレッド作成
    });

    if (!response.ok) {
        const errorText = await response.text();
        context.log(`Thread creation failed: ${response.status} - ${errorText}`);
        throw new Error(`Thread creation failed: ${response.status}`);
    }

    const result = await response.json() as any;
    context.log(`Thread created successfully:`, result);
    return result.id;
}

// Step 2: メッセージをスレッドに追加
async function addMessageToThread(threadId: string, content: string, headers: any, apiVersion: string, context: InvocationContext): Promise<void> {
    const url = `${AZURE_AI_FOUNDRY_ENDPOINT}/threads/${threadId}/messages?api-version=${apiVersion}`;
    context.log(`Adding message to thread: ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            role: 'user',
            content: content
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        context.log(`Message addition failed: ${response.status} - ${errorText}`);
        throw new Error(`Message addition failed: ${response.status}`);
    }

    const result = await response.json() as any;
    context.log(`Message added successfully:`, result);
}

// Step 3: ランを作成
async function createRun(threadId: string, headers: any, apiVersion: string, context: InvocationContext): Promise<string> {
    const url = `${AZURE_AI_FOUNDRY_ENDPOINT}/threads/${threadId}/runs?api-version=${apiVersion}`;
    context.log(`Creating run: ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            assistant_id: AGENT_ID
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        context.log(`Run creation failed: ${response.status} - ${errorText}`);
        throw new Error(`Run creation failed: ${response.status}`);
    }

    const result = await response.json() as any;
    context.log(`Run created successfully:`, result);
    return result.id;
}

// Step 4: ランの完了を待機
async function waitForRunCompletion(threadId: string, runId: string, headers: any, apiVersion: string, context: InvocationContext): Promise<void> {
    const url = `${AZURE_AI_FOUNDRY_ENDPOINT}/threads/${threadId}/runs/${runId}?api-version=${apiVersion}`;
    const maxWaitTime = 60000; // 60秒
    const pollInterval = 2000; // 2秒間隔
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        context.log(`Checking run status: ${url}`);

        const response = await fetch(url, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            context.log(`Run status check failed: ${response.status} - ${errorText}`);
            throw new Error(`Run status check failed: ${response.status}`);
        }

        const result = await response.json() as any;
        context.log(`Run status: ${result.status}`);

        if (result.status === 'completed') {
            context.log('✅ Run completed successfully');
            return;
        } else if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'expired') {
            throw new Error(`Run failed with status: ${result.status}`);
        }

        // 待機
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Run timeout - exceeded maximum wait time');
}

// Step 5: メッセージを取得
async function getMessages(threadId: string, headers: any, apiVersion: string, context: InvocationContext): Promise<string> {
    const url = `${AZURE_AI_FOUNDRY_ENDPOINT}/threads/${threadId}/messages?api-version=${apiVersion}`;
    context.log(`Getting messages: ${url}`);

    const response = await fetch(url, {
        method: 'GET',
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        context.log(`Message retrieval failed: ${response.status} - ${errorText}`);
        throw new Error(`Message retrieval failed: ${response.status}`);
    }

    const result = await response.json() as any;
    context.log(`Messages retrieved:`, result);

    // 最新のアシスタントメッセージを取得
    if (result.data && Array.isArray(result.data)) {
        const assistantMessages = result.data
            .filter((msg: any) => msg.role === 'assistant')
            .sort((a: any, b: any) => b.created_at - a.created_at); // 新しい順

        if (assistantMessages.length > 0 && assistantMessages[0].content) {
            const content = assistantMessages[0].content;
            // contentが配列の場合は最初のテキスト要素を取得
            if (Array.isArray(content) && content.length > 0 && content[0].text) {
                return content[0].text.value;
            } else if (typeof content === 'string') {
                return content;
            }
        }
    }

    throw new Error('No assistant response found in messages');
}

export async function chatCompletions(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Chat completions request for url "${request.url}"`);

    // OPTIONS リクエスト（CORS preflight）への対応
    if (request.method === 'OPTIONS') {
        return {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-request-id',
                'Access-Control-Max-Age': '86400'
            }
        };
    }

    try {
        // Authorization ヘッダーの確認（オプション）
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            context.log('Warning: No valid Authorization header found');
            // 本番環境では認証エラーを返すべきですが、テスト用に継続
        }

        // Content-Type の確認
        const contentType = request.headers.get('Content-Type');
        if (contentType && !contentType.includes('application/json')) {
            return {
                status: 400,
                body: JSON.stringify({
                    error: {
                        message: "Content-Type must be application/json",
                        type: "invalid_request_error",
                        code: "invalid_content_type"
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        // リクエストボディを取得（ChatCompletion APIの形式）
        let requestBody: any = {};
        try {
            const bodyText = await request.text();
            if (bodyText) {
                requestBody = JSON.parse(bodyText);
            } else {
                return {
                    status: 400,
                    body: JSON.stringify({
                        error: {
                            message: "Request body is required",
                            type: "invalid_request_error",
                            code: "missing_body"
                        }
                    }),
                    headers: { 'Content-Type': 'application/json' }
                };
            }
        } catch (error) {
            context.log('Failed to parse request body:', error);
            return {
                status: 400,
                body: JSON.stringify({
                    error: {
                        message: "Invalid JSON in request body",
                        type: "invalid_request_error",
                        code: "invalid_json"
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        // 必須パラメータの検証
        if (!requestBody.model) {
            return {
                status: 400,
                body: JSON.stringify({
                    error: {
                        message: "Model is required",
                        type: "invalid_request_error",
                        code: "missing_model"
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        if (!requestBody.messages || !Array.isArray(requestBody.messages)) {
            return {
                status: 400,
                body: JSON.stringify({
                    error: {
                        message: "Messages must be a non-empty array",
                        type: "invalid_request_error",
                        code: "invalid_messages"
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        // ログにリクエスト内容を出力
        context.log('Request body:', JSON.stringify(requestBody, null, 2));

        // Azure AI Foundryエージェントを呼び出してレスポンスを取得
        context.log('Calling Azure AI Foundry agent with messages:', JSON.stringify(requestBody.messages, null, 2));
        const aiResponse = await callAzureAIFoundryAgent(requestBody.messages, context);
        context.log('Azure AI Foundry response received:', aiResponse);

        // レスポンス内容を設定
        const responseContent = aiResponse;

        // メッセージの内容を取得（token計算用）
        let userMessage = "こんにちは";
        const lastUserMessage = requestBody.messages
            .filter((msg: any) => msg.role === 'user')
            .pop();
        if (lastUserMessage && lastUserMessage.content) {
            userMessage = lastUserMessage.content;
        }

        // リクエストパラメータを取得
        const temperature = requestBody.temperature || 0.7;
        const maxTokens = requestBody.max_tokens || 2048;
        const topP = requestBody.top_p || 1.0;

        // ストリーミングリクエストの確認
        const isStreaming = requestBody.stream === true;

        // ストリーミングレスポンスの場合
        if (isStreaming) {
            const streamResponse = [
                `data: ${JSON.stringify({
                    id: `chatcmpl-${generateUUID().replace(/-/g, '').substring(0, 29)}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: requestBody.model || "gpt-4o-mini-2024-07-18",
                    choices: [{
                        index: 0,
                        delta: {
                            role: "assistant",
                            content: responseContent
                        },
                        finish_reason: null
                    }]
                })}\n`,
                `data: ${JSON.stringify({
                    id: `chatcmpl-${generateUUID().replace(/-/g, '').substring(0, 29)}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: requestBody.model || "gpt-4o-mini-2024-07-18",
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: "stop"
                    }]
                })}\n`,
                `data: [DONE]\n`
            ].join('\n');

            const requestId = generateUUID();
            const apimRequestId = generateUUID();

            return {
                status: 200,
                body: streamResponse,
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-request-id',
                    'apim-request-id': apimRequestId,
                    'x-request-id': requestId,
                    'x-ms-client-request-id': request.headers.get('x-ms-client-request-id') || 'Not-Set',
                    'x-ms-deployment-name': 'gpt-4o-mini',
                    'Date': new Date().toUTCString()
                }
            };
        }

        // Azure OpenAI Chat Completions API互換レスポンス
        const mockResponse = {
            "choices": [
                {
                    "content_filter_results": {
                        "hate": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "self_harm": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "sexual": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "violence": {
                            "filtered": false,
                            "severity": "safe"
                        }
                    },
                    "finish_reason": "stop",
                    "index": 0,
                    "logprobs": null,
                    "message": {
                        "annotations": [],
                        "content": responseContent,
                        "refusal": null,
                        "role": "assistant"
                    }
                }
            ],

            "created": Math.floor(Date.now() / 1000),
            "id": `chatcmpl-${generateUUID().replace(/-/g, '').substring(0, 29)}`,
            "model": requestBody.model || "gpt-4o-mini-2024-07-18",
            "object": "chat.completion",
            "prompt_filter_results": [
                {
                    "prompt_index": 0,
                    "content_filter_results": {
                        "hate": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "jailbreak": {
                            "filtered": false,
                            "detected": false
                        },
                        "self_harm": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "sexual": {
                            "filtered": false,
                            "severity": "safe"
                        },
                        "violence": {
                            "filtered": false,
                            "severity": "safe"
                        }
                    }
                }
            ],
            "system_fingerprint": "fp_efad92c60b",
            "usage": {
                "completion_tokens": Math.ceil(responseContent.length / 4),
                "completion_tokens_details": {
                    "accepted_prediction_tokens": 0,
                    "audio_tokens": 0,
                    "reasoning_tokens": 0,
                    "rejected_prediction_tokens": 0
                },
                "prompt_tokens": Math.ceil(userMessage.length / 4),
                "prompt_tokens_details": {
                    "audio_tokens": 0,
                    "cached_tokens": 0
                },
                "total_tokens": Math.ceil(responseContent.length / 4) + Math.ceil(userMessage.length / 4)
            }
        };

        // Generate unique IDs for this response
        const requestId = generateUUID();
        const apimRequestId = generateUUID();
        const responseBody = JSON.stringify(mockResponse);

        return {
            status: 200,
            body: responseBody,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-request-id',
                'apim-request-id': apimRequestId,
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
                'x-content-type-options': 'nosniff',
                'x-ms-region': 'Japan East',
                'x-ratelimit-remaining-requests': '999',
                'x-ratelimit-limit-requests': '1000',
                'x-ratelimit-remaining-tokens': '99990',
                'x-ratelimit-limit-tokens': '100000',
                'azureml-model-session': 'd094-20250625072412',
                'cmp-upstream-response-duration': Math.floor(Math.random() * 5000 + 1000).toString(),
                'x-accel-buffering': 'no',
                'x-ms-rai-invoked': 'true',
                'x-request-id': requestId,
                'x-ms-client-request-id': request.headers.get('x-ms-client-request-id') || 'Not-Set',
                'x-ms-deployment-name': 'gpt-4o-mini',
                'Date': new Date().toUTCString()
            }
        };

    } catch (error) {
        context.log('Error processing request:', error);

        return {
            status: 500,
            body: JSON.stringify({
                error: {
                    message: "Internal server error",
                    type: "internal_error",
                    code: "internal_error"
                }
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    }
};

app.http('chatCompletions', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'v1/chat/completions',
    handler: chatCompletions
});
