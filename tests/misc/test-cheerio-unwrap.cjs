const cheerio = require('cheerio');

const testHtml = `
<section class="section prereq">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: oauth_admin in DevOps Change Velocity.</p>
  <ul class="ul">
    <li class="li">
      Admin account in GitHub.
      <div class="itemgroup info">
        <div class="note note note_note">
          <span class="note__title">Note:</span>
          The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.
        </div>
      </div>
    </li>
  </ul>
</section>
`;

const $ = cheerio.load(testHtml);
const $elem = $('section.prereq');

console.log('Before unwrapping:');
console.log('  itemgroup/info count:', $elem.find('div.itemgroup, div.info').length);
console.log('  note count:', $elem.find('div.note').length);

// Unwrap itemgroup/info
$elem.find('div.itemgroup, div.info').each((i, wrapper) => {
  console.log('\nUnwrapping:', $(wrapper).attr('class'));
  $(wrapper).replaceWith($(wrapper).html());
});

console.log('\n\nAfter unwrapping itemgroup/info:');
console.log('  note count:', $elem.find('div.note').length);
console.log('\nHTML structure:');
console.log($elem.html());
