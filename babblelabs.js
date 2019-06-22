const request = require('request');
const fs = require('fs');


const BASE_URL = 'https://api.babblelabs.com';

function login(userId, password) {
    return new Promise((resolve, reject) => {

        const body = {
            userId,
            password,
        };

        request.post(`${BASE_URL}/accounts/api/auth/login`, { body, json: true }, (err, response, body) => {
            if (err) return reject(err);
            if (response.statusCode >= 300) return reject(new Error('Something went wrong'));
            return resolve(body);
        })
    })
}

function clearAudio(token, userId, filePath, targetPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createReadStream(filePath);
        const audioInputType = `audio/${filePath.split('.').pop()}`;
        const Authorization = token;
        const headers = { Authorization, [`Content-Type`]: audioInputType };
        request.post(`${BASE_URL}/audioEnhancer/api/audio/stream/${userId}`, { body: file, encoding: null, headers }, (err, response, body) => {
            if (err) return reject(err);
            if (Buffer.isBuffer(body)) {
                const target = fs.createWriteStream(targetPath);
                target.write(body, (err) => {
                    if (err) return reject(new Error('Error writing file'));
                    return resolve({ success: true, targetPath });
                });
            } else {

            }
        })
    })
}

module.exports = {
    login,
    clearAudio,
}