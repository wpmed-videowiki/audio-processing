const fs = require('fs');
const path = require('path');
const request = require('request');
const AWS = require('aws-sdk');

const BUCKET_NAME = 'vwpmedia';
const REGION = 'eu-west-1';
const CLOUDFRONT_BASE_URL = process.env.CLOUDFRONT_URL;

const s3 = new AWS.S3({
  signatureVersion: 'v4',
  region: REGION,
  accessKeyId: process.env.S3_ACCESS_KEY, 
  secretAccessKey: process.env.S3_ACCESS_SECRET
})

function getRemoteFile(url, callback) {
  const filePath = path.join('tmp', `file-${parseInt(Date.now() + Math.random() * 1000000) + "." + url.split('.').pop()}`);
  request
    .get(url)
    .on('error', (err) => {
      throw (err)
    })
    .pipe(fs.createWriteStream(filePath))
    .on('error', (err) => {
      callback(err)
    })
    .on('finish', () => {
      callback(null, filePath)
    })
}

function uploadToS3(filePath, callback) {
  const fileName = filePath.split('/').pop(); 
  s3.upload({
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: fs.createReadStream(filePath),
    ContentDisposition: 'attachement',
  }, (err, res) => {
    if (err) {
      return callback(err);
    }
    const url = `${CLOUDFRONT_BASE_URL}/${fileName}`;

    return callback(null, { url, ETag: res.ETag, Key: fileName });
  })
}


function deleteFromS3(key, callback = () => {}) {
  s3.deleteObject({
    Key: key,
    Bucket: BUCKET_NAME,
  }, (err, result) => {
    if (err) return callback(err);
    return callback(null, result);
  })
}

module.exports = {
    uploadToS3,
    getRemoteFile,
    deleteFromS3
}