const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function trimSilenceFromAudio(filePath, callback = (err, outputPath) => {}) {
    const fileExtension = filePath.split('.').pop();
    const tmpPath = path.join('tmp', `tmpAudio-${Date.now()}.${fileExtension}`);
    const targetPath = path.join('tmp', `silenced-${Date.now()}.${fileExtension}`);

    exec(`sox ${filePath} ${tmpPath} silence -l 1 0.1 1% -1 2.0 1% reverse`, (err, stdout, stderr) => {
        if (err || !fs.existsSync(tmpPath)) {
            fs.unlink(tmpPath, () => {});
            return callback(err);
        }
        exec(`sox ${tmpPath} ${targetPath} silence -l 1 0.1 1% -1 2.0 1% reverse`, (err, stdout, stderr) => {
            fs.unlink(tmpPath, () => {});
            if (err || !fs.existsSync(targetPath)) {
                fs.unlink(targetPath, () => {});
                return callback(err);
            }
            return callback(null, targetPath);
        })
    })
}

module.exports = {
    trimSilenceFromAudio,
}


/* Commands used to trim silence from begining and end of file
    sox in.wav out.wav silence -l 1 0.1 1% -1 2.0 1% reverse
        Trim audio from the begining of the file, then reverse it
    sox tmp.wav out.wav silence -l 1 0.1 1% -1 2.0 1% reverse
        Trim audio from the begining of the reversed version, then reverse again to get original order
*/