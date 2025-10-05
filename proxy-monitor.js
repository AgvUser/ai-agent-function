const http = require('http');
const httpProxy = require('http-proxy');

// プロキシサーバーを作成
const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
    console.log('\n=== リクエスト情報 ===');
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.url}`);
    console.log('Headers:', req.headers);

    // CORSヘッダーを設定
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ms-client-request-id, api-key');

    // OPTIONSリクエストへの対応
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        if (body) {
            console.log('Request Body:', body);
            try {
                const parsed = JSON.parse(body);
                console.log('Parsed Request:', JSON.stringify(parsed, null, 2));
            } catch (e) {
                console.log('Body is not JSON');
            }
        }

        // URLのルーティング修正
        let targetUrl = req.url;
        if (req.url === '/api') {
            targetUrl = '/api/v1/chat/completions';
            console.log(`URL rewritten: ${req.url} -> ${targetUrl}`);
        } else if (req.url.startsWith('/api') && !req.url.includes('/v1/chat/completions')) {
            targetUrl = req.url.replace('/api', '/api/v1/chat/completions');
            console.log(`URL rewritten: ${req.url} -> ${targetUrl}`);
        }

        // ヘッダーの修正 - Authorization ヘッダーを正しく設定
        if (req.headers['api-key'] && !req.headers['authorization']) {
            req.headers['authorization'] = `Bearer ${req.headers['api-key']}`;
            console.log('Authorization header set from api-key');
        }

        // リクエストのURLを書き換え
        req.url = targetUrl;

        console.log(`Forwarding to: http://127.0.0.1:7071${targetUrl}`);
        console.log('Modified headers:', req.headers);

        // 新しいリクエストを作成してAzure Functionsに送信
        const options = {
            hostname: '127.0.0.1',
            port: 7071,
            path: targetUrl,
            method: req.method,
            headers: {
                ...req.headers,
                'host': '127.0.0.1:7071'
            }
        };

        const proxyReq = http.request(options, (proxyRes) => {
            console.log('\n=== レスポンス情報 ===');
            console.log(`Status: ${proxyRes.statusCode}`);
            console.log('Headers:', proxyRes.headers);

            // レスポンスヘッダーをコピー
            Object.keys(proxyRes.headers).forEach(key => {
                res.setHeader(key, proxyRes.headers[key]);
            });

            // CORSヘッダーを再設定（上書き）
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ms-client-request-id, api-key');

            res.writeHead(proxyRes.statusCode);

            let responseBody = '';
            proxyRes.on('data', chunk => {
                responseBody += chunk.toString();
                res.write(chunk);
            });

            proxyRes.on('end', () => {
                if (responseBody) {
                    console.log('Response Body:', responseBody);
                    try {
                        const parsed = JSON.parse(responseBody);
                        console.log('Parsed Response:', JSON.stringify(parsed, null, 2));
                    } catch (e) {
                        console.log('Response is not JSON (possibly streaming)');
                    }
                }
                console.log('================================\n');
                res.end();
            });
        });

        proxyReq.on('error', (error) => {
            console.log('Request Error:', error.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: `Request error: ${error.message}`,
                        type: "request_error",
                        code: "connection_failed"
                    }
                }));
            }
        });

        // リクエストボディを送信
        if (body) {
            proxyReq.write(body);
        }
        proxyReq.end();
    });

    req.on('error', (err) => {
        console.log('Request Error:', err.message);
        if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: `Request error: ${err.message}`,
                    type: "request_error",
                    code: "bad_request"
                }
            }));
        }
    });
});

server.listen(8080, () => {
    console.log('改良されたプロキシサーバーがポート8080で起動しました');
    console.log('Genie AIの設定を http://localhost:8080/api に変更してください');
    console.log('Azure Functionsが http://127.0.0.1:7071 で動作していることを確認してください');
    console.log('デバッグ情報が詳細に表示されます');
});
