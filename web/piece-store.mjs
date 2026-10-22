// abstract-chunk-store API used by WebTorrent. A fresh directory per client/run.
// Only that directory is deleted on destroy; journals and other stores are untouched.
export class SessionPieceStore {
  constructor(chunkLength, opts = {}) {
    this.chunkLength=chunkLength;this.length=opts.length;this.name='kadr-wt-session-'+crypto.randomUUID();
    this.closed=false;this.memory=new Map();this.memoryBytes=0;this.operations=new Set();
    this.ready=(async()=>{
      if(!opts.useMemory && globalThis.navigator?.storage?.getDirectory){
        try {
          this.parent=await navigator.storage.getDirectory();this.directory=await this.parent.getDirectoryHandle(this.name,{create:true});
          const handle=await this.directory.getFileHandle('probe',{create:true});
          if(typeof handle.createWritable!=='function')throw Error('opfs_writable_unavailable');
          const writer=await handle.createWritable();await writer.close();await this.directory.removeEntry('probe');
          this.mode='OPFS isolated session';opts.onMode?.(this.mode);return;
        }catch{
          if(this.parent)await this.parent.removeEntry(this.name,{recursive:true}).catch(()=>{});
          this.directory=null;this.parent=null;
        }
      }
      this.mode='RAM isolated session (OPFS unavailable)';opts.onMode?.(this.mode);
    })();
  }
  operation(work, callback) {
    const operation=(async()=>{await this.ready;if(this.closed)throw Error('piece_store_closed');return work();})();
    this.operations.add(operation);
    operation.then(value=>{this.operations.delete(operation);callback(null,value);},error=>{this.operations.delete(operation);callback(error);});
  }
  put(index, bytes, callback = () => {}) {
    const data=new Uint8Array(bytes);
    this.operation(async()=>{
      if(this.directory){
        const handle=await this.directory.getFileHandle(String(index),{create:true});const writer=await handle.createWritable();
        try {await writer.write(data);}finally{await writer.close();}
      }else{
        const old=this.memory.get(index)?.length || 0;
        if(this.memoryBytes-old+data.length>192*1024*1024)throw Error('piece_store_ram_limit_192MiB');
        this.memory.set(index,data);this.memoryBytes+=data.length-old;
      }
    },callback);
  }
  get(index, opts, callback) {
    if(typeof opts==='function'){callback=opts;opts={};}opts ||= {};callback ||= ()=>{};
    this.operation(async()=>{
      let bytes;
      if(this.directory){
        const handle=await this.directory.getFileHandle(String(index));bytes=new Uint8Array(await (await handle.getFile()).arrayBuffer());
      }else bytes=this.memory.get(index);
      if(!bytes?.length)throw Error('piece_not_available');
      const offset=opts.offset || 0,end=opts.length===undefined?bytes.length:offset+opts.length;
      if(offset<0 || end>bytes.length)throw Error('piece_range_invalid');return bytes.subarray(offset,end);
    },callback);
  }
  close(callback=()=>{}) {this.closed=true;Promise.allSettled([...this.operations]).then(()=>callback(null));}
  destroy(callback=()=>{}) {
    this.close(async()=>{
      try {await this.ready;this.memory.clear();this.memoryBytes=0;if(this.parent)await this.parent.removeEntry(this.name,{recursive:true}).catch(error=>{if(error.name!=='NotFoundError')throw error;});callback(null);}
      catch(error){callback(error);}
    });
  }
}
