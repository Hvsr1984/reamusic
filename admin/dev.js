import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/admin.js';
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://local').pathname;
 if(['/admin.css','/admin.js'].includes(path)){
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');
  res.end(await readFile(new URL('./public'+path,import.meta.url)));return;
 }
 if(path!=='/api/admin')req.query={view:path.slice(1)||'dashboard'};
 await handler(req,res);
}).listen(4501,'127.0.0.1',()=>console.log('Admin at http://127.0.0.1:4501'));
