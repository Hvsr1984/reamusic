import fs from 'node:fs';
const output = new URL('./dist/', import.meta.url);
fs.mkdirSync(output, {recursive:true});
for (const name of ['index.html','js','css','assets']) {
  fs.cpSync(new URL(name, import.meta.url), new URL(name, output), {recursive:true});
}
