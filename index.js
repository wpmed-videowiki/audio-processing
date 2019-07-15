const fs = require('fs');
const { exec } = require('child_process');
const langs = ['en', 'hi', 'es', 'ar', 'ja'];
const APP_DIRS = ['./tmp'];

// Create necessary file dirs 
APP_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
})


langs.forEach(function(lang, index) {
  const command = `node_modules/pm2/bin/pm2 start worker.js -i ${lang === 'en' ? '2' : '1'} --name=videowiki_audio_processor_${lang} -- ${lang}` 
  setTimeout(() => {
    exec(command, (err, stdout) => {
      console.log(command);
      if (err) {
        console.log('error initializing ', lang, err);
      }
    });
  }, index * 1500);
})