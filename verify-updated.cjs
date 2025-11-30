const {Client}=require('@notionhq/client');require('dotenv').config({path:'./server/.env'});
const notion=new Client({auth:process.env.NOTION_TOKEN});
const pageId='2b6a89fedba5812794c2f8f0ed512d01';
function txt(b){const t=b[b.type];if(!t)return'';return (t.rich_text||[]).map(x=>x.plain_text|| (x.text&&x.text.content)||'').join('');}
(async()=>{
  let blocks=[];let cursor;do{const resp=await notion.blocks.children.list({block_id:pageId,page_size:100,start_cursor:cursor});blocks.push(...resp.results);cursor=resp.next_cursor;}while(cursor);
  console.log('Total top-level blocks:',blocks.length);
  const topIndex=blocks.findIndex(b=> b.type==='paragraph' && /All Tomcat WAR CIs which are not connected/.test(txt(b)));
  console.log('Top-level index of target paragraph:',topIndex);
  async function searchNested(id,depth){
    const resp=await notion.blocks.children.list({block_id:id,page_size:100});
    for(const b of resp.results){
      if(b.type==='paragraph' && /All Tomcat WAR CIs which are not connected/.test(txt(b))){
        console.log('Found nested paragraph at depth',depth,'parent block id',id,'paragraph id',b.id);
        return true;
      }
      if(b.has_children){const found=await searchNested(b.id,depth+1);if(found)return true;}
    }
    return false;
  }
  let nestedFound=false;
  for(const b of blocks){if(b.has_children){nestedFound=await searchNested(b.id,1);if(nestedFound)break;}}
  if(!nestedFound) console.log('Paragraph not found nested (only top-level).');
})();
