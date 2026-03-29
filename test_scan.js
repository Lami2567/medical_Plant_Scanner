const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch'); // wait, node-fetch might not be installed, better use native HTTP or start the app logic directly

const { identifyPlant } = require('./src/services/plantnet');
const { getMultiSourceKnowledge } = require('./src/routes/plant'); // wait, getMultiSourceKnowledge is not exported.

// Let's just run an express server and test it using a script
const child_process = require('child_process');

async function test() {
  const child = child_process.spawn('node', ['server.js'], { stdio: 'inherit' });
  
  // wait for server to start
  await new Promise(r => setTimeout(r, 2000));
  
  // test it with curl
  console.log("Running curl to test image upload...");
  child_process.exec('curl -X POST -F "image=@TestImages/Bidens pilosa.jpg" http://localhost:8000/scan-plant', (err, stdout, stderr) => {
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
    child.kill();
  });
}
test();
