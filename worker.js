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

const PROCESS_AUDIO_QUEUE = `PROCESS_AUDIO_QUEUE_${lang}`;
const PROCESS_AUDIO_FINISHED_QUEUE = `PROCESS_AUDIO_FINISHED_QUEUE_${lang}`;

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
    channel = ch;
    channel.prefetch(1);
    console.log('connection created')
    channel.assertQueue(PROCESS_AUDIO_QUEUE, { durable: true });
    channel.assertQueue(PROCESS_AUDIO_FINISHED_QUEUE, { durable: true });
    channel.consume(PROCESS_AUDIO_QUEUE, processAudioCallback, { noAck: false });

    // ch.sendToQueue(PROCESS_AUDIO_QUEUE, new Buffer(JSON.stringify({ humanvoiceId: "5ccc3dc303e14d25df136f3d", audioPosition: 0 })))
  })
})


function processAudioCallback(msg) {
    const { humanvoiceId, audioPosition } = JSON.parse(msg.content.toString());

    processAudio(humanvoiceId, audioPosition, (err, result) => {
      if (err) {
        console.log('error processing audio', err);
        updateAudioStatus(humanvoiceId, audioPosition, { status: 'process_failed', processing: false });
      } else if (result && result.success) {
        channel.sendToQueue(PROCESS_AUDIO_FINISHED_QUEUE, new Buffer(JSON.stringify({ humanvoiceId, audioPosition })));
      }
      console.log('Final result', err, result);
      channel.ack(msg);
    });
}

function processAudio(humanvoiceId, audioPosition, callback = () => {}) {
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
    const audioURL = audioItem.audioURL.indexOf('https') === -1 ? `https:${audioItem.audioURL}` : audioItem.audioURL;
    console.log('audio url', audioURL); 
    utils.getRemoteFile(audioURL, (err, filePath) => {
      if (err) {
        return callback(err);
      }
      
      const processingStepsFunc = [
        (cb) => {
          console.log('processing');
          audioProcessor.trimSilenceFromAudio(filePath, (err, outputPath) => {
            fs.unlinkSync(filePath, () => {});
            if (err) {
              return cb(err);
            }
            return cb(null, outputPath)
          })
        },
        (trimmedPath, cb) => {
          audioProcessor.compressAudioFile(trimmedPath, (err, compressedPath) => {
            if (err) return callback(null, trimmedPath);
            fs.unlink(trimmedPath, () => {});
            return cb(null, compressedPath);
          })
        }
      ];
      
      async.waterfall(processingStepsFunc, (err, finalFilePath) => {
        console.log('Processed succesfully', err, finalFilePath);
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
          HumanVoiceModel.findByIdAndUpdate(humanvoiceId, { $set: updateObj }, { new: true }, (err, res) => {
            if (err) return callback(err);
            // Delete old audio file
            utils.deleteFromS3(audioItem.Key, () => {
              
            })
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