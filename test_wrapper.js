const { fetchPreludeData } = require('./src/services/prelude.js');

async function test() {
  const result = await fetchPreludeData('Bridelia micrantha');
  console.log('Result:', JSON.stringify(result, null, 2));
}

test();
