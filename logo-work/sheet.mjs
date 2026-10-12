import sharp from 'sharp';
const logo = 'public/images/aeson-sports-management-logo.png';
const old = 'design-sources/aeson-sports-management-original.png';
const bgs = [['#FFFFFF','white'],['#F4F5F7','light grey'],['#000000','old black card'],['#171B20','dark']];
const tile = await sharp(logo).resize(380).png().toBuffer();
const tiles = [];
for (const [i,[c]] of bgs.entries()) tiles.push({ input: await sharp({create:{width:420,height:190,channels:4,background:c}}).composite([{input:tile,gravity:'centre'}]).png().toBuffer(), left:(i%2)*430, top:Math.floor(i/2)*200 });
// 4x zoom of edges (stopwatch top + "A" hole) on white
const z1 = await sharp(logo).extract({left:440,top:0,width:120,height:70}).flatten({background:'#fff'}).resize(420,245,{kernel:'nearest'}).png().toBuffer();
const z2 = await sharp(logo).extract({left:20,top:30,width:110,height:110}).flatten({background:'#fff'}).resize(245,245,{kernel:'nearest'}).png().toBuffer();
tiles.push({input:z1,left:0,top:400},{input:z2,left:430,top:400});
await sharp({create:{width:860,height:655,channels:4,background:'#888'}}).composite(tiles).png().toFile('logo-work/logo-check.png');
