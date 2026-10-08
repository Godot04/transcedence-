function sendJson(res, statusCode, payload)
{
    res.writeHead(statusCode,
    {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
}

function redirect(res, location)
{
    res.writeHead(302, {Location: location});
    res.end();
}

function readRawBody(req, maxSize)
{
    return new Promise((resolve, reject) =>
    {
        const chunks = [];
        let totalSize = 0;

        req.on('data', (chunk) =>
        {
            totalSize += chunk.length;

            if (totalSize > maxSize)
            {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });

        req.on('end', () =>
        {
            resolve(Buffer.concat(chunks));
        });

        req.on('error', reject);
    });
}

function readBody(req)
{
    return new Promise((resolve, reject) =>
    {
        let body = '';

        req.on('data', (chunk) =>
        {
            body += chunk;

            if (body.length > 4_000_000)
            {
                reject(new Error('Payload too large'));
                req.destroy();
            }
        });

        req.on('end', () =>
        {
            resolve(body);
        });

        req.on('error', reject);
    });
}

module.exports =
{
    sendJson,
    redirect,
    readRawBody,
    readBody,
};