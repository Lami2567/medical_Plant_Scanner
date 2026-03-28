const cheerio = require('cheerio');
const fs = require('fs');

function runTest() {
  const data = fs.readFileSync('prelude_detail.html', 'utf8');
  const $ = cheerio.load(data);
  let treatments = '';
  
  $('.plant-reference-recipe strong').each((i, el) => {
    let text = $(el).text().trim();
    if (text) {
      // Clean up common html line breaks
      text = text.replace(/<br\s*\/?>/gi, ' ');
      treatments += text + '\n';
    }
  });

  console.log('---TREATMENTS---');
  console.log(treatments.substring(0, 500));
}

runTest();
