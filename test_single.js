const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

async function testSingle() {
  const apiUrl = 'http://localhost:8000/scan-plant';
  const imagePath = path.join(__dirname, 'TestImages', 'Bridelia micrantha Baill.jpg');
  
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));

  try {
    const response = await axios.post(apiUrl, form, {
      headers: { ...form.getHeaders() }
    });
    console.log('Result:', JSON.stringify(response.data.uses, null, 2));
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message);
  }
}

testSingle();
