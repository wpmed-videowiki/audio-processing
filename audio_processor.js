const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const babblelabs =require('./babblelabs');
const BABBLELABS_USERNAME = process.env.BABBLELABS_USERNAME;
const BABBLELABS_PASSWORD = process.env.BABBLELABS_PASSWORD;

function trimSilenceFromAudio(filePath, callback = (err, outputPath) => { }) {
    const fileExtension = filePath.split('.').pop();
    const tmpPath = path.join('tmp', `tmpAudio-${Date.now()}.${fileExtension}`);
    const targetPath = path.join('tmp', `silenced-${Date.now()}.${fileExtension}`);

    exec(`sox ${filePath} ${targetPath} silence -l 1 0.1 1% -1 2.0 1%`, (err, stdout, stderr) => {
        if (err || !fs.existsSync(targetPath)) { 
            // fs.unlink(tmpPath, () => { });
            return callback(err);
        }
        return callback(null, targetPath);
        // exec(`sox ${tmpPath} ${targetPath} silence -l 1 0.1 1% reverse`, (err, stdout, stderr) => {
        //     fs.unlink(tmpPath, () => { });
        //     if (err || !fs.existsSync(targetPath)) {
        //         fs.unlink(targetPath, () => { });
        //         return callback(err);
        //     }
        //     return callback(null, targetPath);
        // })
    })
}

function clearBackgroundNoise(filePath, callback = (err, outputPath) => {}) {
    const fileExtension = filePath.split('.').pop();
    const targetPath = path.join('tmp', `cleared-${Date.now()}.${fileExtension}`);

    babblelabs
    .login(BABBLELABS_USERNAME, BABBLELABS_PASSWORD)
    .then((res) => {
        const { token_type, auth_token } = res;
        const token = `${token_type} ${auth_token}`;
        return babblelabs.clearAudio(token, BABBLELABS_USERNAME, filePath, targetPath);
    })
    .then((res) => {
        return callback(null, targetPath);
    })
    .catch((err) => {
        return callback(err);
    })
}

function compressAudioFile(filePath, callback) {
    const fileExtension = filePath.split('.').pop();
    const targetPath = path.join('tmp', `tiny-${Date.now()}.${fileExtension}`);
    exec(`sox ${filePath} ${targetPath} remix 1`, (err, stdout, stderr) => {
        if (err || !fs.existsSync(targetPath)) return callback(err);
        return callback(null, targetPath);
    });
}

function convertToWav(filePath, callback) {
    const outputPath = path.join(__dirname, 'tmp', `converted_${Date.now()}.wav`);

    exec(`ffmpeg -i ${filePath} ${outputPath}`, (err, stdout, stderr) => {
        if (err) return callback(err);
        return callback(null, outputPath);
    })
}

module.exports = {
    clearBackgroundNoise,
    trimSilenceFromAudio,
    compressAudioFile,
    convertToWav,
}


/* Commands used to trim silence from begining and end of file
    sox in.wav out.wav silence -l 1 0.1 1% -1 2.0 1% reverse
        Trim audio from the begining of the file, then reverse it
    sox tmp.wav out.wav silence -l 1 0.1 1% -1 2.0 1% reverse
        Trim audio from the begining of the reversed version, then reverse again to get original order
*/