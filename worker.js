require('dotenv').config({ path: '.env' });
const amqp = require('amqplib/callback_api');
const async = require('async');
const fs = require('fs');
const mongoose = require('mongoose');
const audioProcessor = require('./audio_processor');
const utils = require('./utils');
const HumanVoiceModel = require('./models/HumanVoice');
const ArticleModel = require('./models/Article');

const args = process.argv.slice(2);
const lang = args[0];

const PROCESS_HUMANVOICE_AUDIO_QUEUE = `PROCESS_HUMANVOICE_AUDIO_QUEUE_${lang}`;
const PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE = `PROCESS_HUMANVOICE_AUDIO_FINISHED_QUEUE_${lang}`;

const PROCESS_ARTICLE_AUDIO_QUEUE = `PROCESS_ARTICLE_AUDIO_QUEUE_${lang}`;
const PROCESS_ARTICLE_AUDIO_FINISHED_QUEUE = `PROCESS_ARTICLE_AUDIO_FINISHED_QUEUE_${lang}`;

const DB_CONNECTION = `${process.env.DB_HOST_URL}-${lang}`;
// const DB_CONNECTION = 'mongodb://localhost/videowiki-en'
console.log('connecting to database ', DB_CONNECTION);
mongoose.connect(DB_CONNECTION)
let channel;
amqp.connect(process.env.RABBITMQ_HOST_URL, (err, conn) => {
  if (err) {
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


    channel.assertQueue(PROCESS_ARTICLE_AUDIO_QUEUE, { durable: true });
    channel.assertQueue(PROCESS_ARTICLE_AUDIO_FINISHED_QUEUE, { durable: true });
    // ch.sendToQueue(PROCESS_AUDIO_QUEUE, new Buffer(JSON.stringify({ humanvoiceId: "5ccc3dc303e14d25df136f3d", audioPosition: 0 })))
    channel.consume(PROCESS_HUMANVOICE_AUDIO_QUEUE, processHumanvoiceAudioCallback, { noAck: false });
    channel.consume(PROCESS_ARTICLE_AUDIO_QUEUE, processArticleAudioCalback, { noAck: false });
  })
})


function processHumanvoiceAudioCallback(msg) {
  const { humanvoiceId, audioPosition } = JSON.parse(msg.content.toString());

  processHumanvoiceAudio(humanvoiceId, audioPosition, (err, result) => {
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

function processArticleAudioCalback(msg) {
  const { articleId, position } = JSON.parse(msg.content.toString());

  processArticleAudio(articleId, position, (err, result) => {
    let response = {
      articleId,
      position,
      success: false,
    };

    if (err) {
      console.log('error processing audio', err);
      // updateAudioStatus(humanvoiceId, audioPosition, { status: 'process_failed', processing: false });
    } else if (result && result.success) {
      response.success = true;
    }

    console.log('acked')
    // channel.sendToQueue(PROCESS_ARTICLE_AUDIO_FINISHED_QUEUE, new Buffer(JSON.stringify(response)));
    channel.ack(msg);
  });
}

function processArticleAudio(articleId, position, callback) {
  console.log('starting for article', articleId, position);
  ArticleModel.findById(articleId, (err, article) => {
    if (!article) {
      return callback(new Error('Invalid article id'));
    }
    const audioIndex = article.slides.findIndex((a) => parseInt(a.position) === parseInt(position));
    if (audioIndex === -1) {
      console.log('invalid slide position');
      return callback(new Error('Invalid slide position'));
    }
    // updateAudioStatus(humanvoiceId, audioIndex, { processing: true });

    const slide = article.slides[audioIndex];
    const audioURL = slide.audio;
    processAudio(audioURL, (err, result) => {
      if (err) return callback(err);
      const updateObj = {
        [`slides.${audioIndex}.audio`]: result.url,
        [`slides.${audioIndex}.audioKey`]: result.Key,

        [`slidesHtml.${audioIndex}.audioKey`]: result.Key,
        [`slidesHtml.${audioIndex}.audio`]: result.url,

      }
      console.log('uploaded', result.url)
      ArticleModel.findByIdAndUpdate(articleId, { $set: updateObj }, { new: true }, (err, res) => {
        if (err) return callback(err);
        // Delete old audio file
        // utils.deleteFromS3(audioItem.Key, () => {

        // })
        return callback(null, { success: true, article: res });
      })
    })
  })
}

function processHumanvoiceAudio(humanvoiceId, audioPosition, callback = () => { }) {
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
    const audioURL = audioItem.audioURL;
    processAudio(audioURL, (err, result) => {
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
}

function processAudio(audioURL, callback = () => { }) {
  audioURL = audioURL.indexOf('https') === -1 ? `https:${audioURL}` : audioURL;
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
          fs.unlink(filePath, () => { })
          return cb(null, outputPath);
        })
      },
      (filePath, cb) => {
        console.log('processing', filePath);
        audioProcessor.clearBackgroundNoise(filePath, (err, outputPath) => {
          fs.unlinkSync(filePath, () => { });
          if (err) {
            return cb(err);
          }
          return cb(null, outputPath)
        })
      },
    ];

    async.waterfall(processingStepsFunc, (err, finalFilePath) => {
      console.log('Processed succesfully', err, audioURL);
      if (err || !fs.existsSync(finalFilePath)) return callback(err);

      utils.uploadToS3(finalFilePath, (err, result) => {
        fs.unlink(finalFilePath, () => { });
        if (err) return callback(err);
        return callback(null, result);
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