const { cleanPlantData } = require('./src/services/aiCleaner');

async function test() {
  const result = await cleanPlantData("This is a test. The plant helps cure headaches.");
  console.log("AI Result:", result);
}

test();
