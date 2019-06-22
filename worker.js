require('dotenv').config({path: '.env'});
const amqp = require('amqplib/callback_api');
const async = require('async');
const fs = require('fs');
const mongoose = require('mongoose');
const audioProcessor = require('./audio_processor');
const utils = require('./utils');
const HumanVoiceModel = require('./models/HumanVoice');

const args = process.argv.slice(2);
const lang = args[0];

const PROCESS_HUMANVOICE_AUDIO_QUEUE = `PROCESS_HUMANVOICE_AUDIO_QUEUE_${lang}`;
const PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE = `PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE_${lang}`;

const DB_CONNECTION = `${process.env.DB_HOST_URL}-${lang}`;
// const DB_CONNECTION = 'mongodb://localhost/videowiki-en'
console.log('connecting to database ', DB_CONNECTION);
mongoose.connect(DB_CONNECTION)
let channel;
amqp.connect(process.env.RABBITMQ_HOST_URL, (err, conn) => {
    if(err) {
        console.log('error is', err);
    }

  conn.createChannel((err, ch) => {
    if (err) {
      console.log('Error creating conection ', err);
      return process.exit(1);
    }
    console.log('connection created')
    channel = ch;
    channel.prefetch(1);
    channel.assertQueue(PROCESS_HUMANVOICE_AUDIO_QUEUE, { durable: true });
    channel.assertQueue(PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE, { durable: true });
    // ch.sendToQueue(PROCESS_AUDIO_QUEUE, new Buffer(JSON.stringify({ humanvoiceId: "5ccc3dc303e14d25df136f3d", audioPosition: 0 })))
    channel.consume(PROCESS_HUMANVOICE_AUDIO_QUEUE, processAudioCallback, { noAck: false });
  })
})


function processAudioCallback(msg) {
    const { humanvoiceId, audioPosition } = JSON.parse(msg.content.toString());

    processAudio(humanvoiceId, audioPosition, (err, result) => {
      let response = {
        humanvoiceId,
        audioPosition,
        success: false,
      };

      if (err) {
        console.log('error processing audio', err);
        updateAudioStatus(humanvoiceId, audioPosition, { status: 'process_failed', processing: false });
      } else if (result && result.success) {
        response.success = true;
      }

      console.log('acked')
      channel.sendToQueue(PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE, new Buffer(JSON.stringify(response)));
      channel.ack(msg);
    });
}

function processAudio(humanvoiceId, audioPosition, callback = () => {}) {
  console.log('starting for file', humanvoiceId, audioPosition);
  HumanVoiceModel.findById(humanvoiceId, (err, humanvoice) => {
    if (!humanvoice) {
        return callback(new Error('Invalid human voice id'));
    }
    const audioIndex = humanvoice.audios.findIndex((a) => parseInt(a.position) === parseInt(audioPosition));
    if (audioIndex === -1) {
        console.log('invalid slide position');
        return callback(new Error('Invalid slide position'));
    }
    updateAudioStatus(humanvoiceId, audioIndex, { processing: true });

    const audioItem = humanvoice.audios[audioIndex];
    const audioURL = audioItem.audioURL.indexOf('https') === -1 ? `http:${audioItem.audioURL}` : audioItem.audioURL;
    utils.getRemoteFile(audioURL, (err, filePath) => {
      if (err) {
        return callback(err);
      }
      
      const processingStepsFunc = [
        (cb) => {
          const fileExtension = filePath.split('.').pop().toLowerCase();
          if (fileExtension === 'mp3' || fileExtension === 'wav') return cb(null, filePath);
          console.log('converint to wav');
          audioProcessor.convertToWav(filePath, (err, outputPath) => {
            if (err) {
              console.log(err);
              return cb(null, filePath);
            }
            fs.unlink(filePath, () => {})
            return cb(null, outputPath);
          })
        },
        (filePath, cb) => {
          console.log('processing', filePath);
          audioProcessor.clearBackgroundNoise(filePath, (err, outputPath) => {
            fs.unlinkSync(filePath, () => {});
            if (err) {
              return cb(err);
            }
            return cb(null, outputPath)
          })
        },
        // (trimmedPath, cb) => {
        //   console.log('compressing ')
        //   audioProcessor.compressAudioFile(trimmedPath, (err, compressedPath) => {
        //     if (err) return callback(null, trimmedPath);
        //     fs.unlink(trimmedPath, () => {});
        //     return cb(null, compressedPath);
        //   })
        // }
      ];
      
      async.waterfall(processingStepsFunc, (err, finalFilePath) => {
        console.log('Processed succesfully', err, audioURL);
        if (err || !fs.existsSync(finalFilePath)) return callback(err);
        
        utils.uploadToS3(finalFilePath, (err, result) => {
          fs.unlink(finalFilePath, () => {});
          if (err) return callback(err);
          const updateObj = {
            [`audios.${audioIndex}.processing`]: false,
            [`audios.${audioIndex}.status`]: 'processed',
            [`audios.${audioIndex}.audioURL`]: result.url,
            [`audios.${audioIndex}.Key`]: result.Key,
          }
          console.log('uploaded', result.url)
          HumanVoiceModel.findByIdAndUpdate(humanvoiceId, { $set: updateObj }, { new: true }, (err, res) => {
            if (err) return callback(err);
            // Delete old audio file
            // utils.deleteFromS3(audioItem.Key, () => {
              
            // })
            return callback(null, { success: true, humanvoice: res });
          })
        })
      })
    })
  })
}


function updateAudioStatus(id, audioIndex, { processing, status }) {
  const updateObj = {};
  if (processing !== undefined && processing !== 'undefined') {
    updateObj[`audios.${audioIndex}.processing`] = processing;
  }
  if (status) {
    updateObj[`audios.${audioIndex}.status`] = status;
  }

  HumanVoiceModel.findByIdAndUpdate(id, { $set: updateObj }, { new: true }, (err, res) => {
  })
}