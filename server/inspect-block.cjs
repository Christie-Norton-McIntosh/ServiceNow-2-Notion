const blocks = require('/tmp/blocks-before-clean.json');
const b5 = blocks[5];
const c2 = b5?.numbered_list_item?.children?.[2];
const c0 = c2?.numbered_list_item?.children?.[0];

console.log('Block keys:', Object.keys(c0));
console.log('Has _sn2n_marker?', !!c0._sn2n_marker);
console.log('Marker value:', c0._sn2n_marker);
console.log('Has _sn2n_collected?', !!c0._sn2n_collected);
console.log('\nFull block:');
console.log(JSON.stringify(c0, null, 2).substring(0, 500));
