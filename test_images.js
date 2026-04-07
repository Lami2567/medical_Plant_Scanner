// test_images.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Fire up the server
const server = require('./server'); // This requires server.js and starts it on port 8000

const testImagesDir = path.join(__dirname, 'TestImages');
const apiUrl = `http://localhost:${process.env.PORT || 8000}/scan-plant`;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testAllImages() {
  const images = fs.readdirSync(testImagesDir).filter(file => 
    file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.webp')
  );

  console.log(`Found ${images.length} images to test.`);
  
  // Wait a second for the server to bind port properly
  await delay(1000);

  const results = [];

  for (const image of images) {
    console.log(`\n======================================================`);
    console.log(`Testing Image: ${image}`);
    const imagePath = path.join(testImagesDir, image);
    
    try {
      const form = new FormData();
      form.append('image', fs.createReadStream(imagePath));

      console.time(`Time taken for ${image}`);
      const response = await axios.post(apiUrl, form, {
        headers: {
          ...form.getHeaders()
        }
      });
      console.timeEnd(`Time taken for ${image}`);

      const data = response.data;
      console.log(`✅ Success! Recognized Plant: ${data.plant_name} (${data.scientific_name})`);
      console.log(`Confidence: ${data.confidence_score}%`);
      console.log(`Extracted Medical Properties: ${JSON.stringify(data.medical_properties)}`);
      
      results.push({
        image,
        plant_name: data.plant_name,
        scientific_name: data.scientific_name,
        medical_properties: data.medical_properties,
        uses: data.uses,
        status: 'Success'
      });
    } catch (err) {
      console.log(`❌ Failed for ${image}`);
      if (err.response) {
        console.error(`Error Data:`, err.response.data);
      } else {
        console.error(err.message);
      }
      results.push({
        image,
        error: err.response ? err.response.data : err.message,
        status: 'Failed'
      });
    }

    // Wait slightly between requests to not spam API limits too aggressively if there are any
    await delay(2000);
  }

  console.log(`\n================== TEST SUMMARY ==================`);
  console.log(JSON.stringify(results, null, 2));
  
  // Create artifact or exit
  fs.writeFileSync('test_results_summary.json', JSON.stringify(results, null, 2));
  console.log("Results saved to test_results_summary.json");
  process.exit(0);
}

testAllImages();
