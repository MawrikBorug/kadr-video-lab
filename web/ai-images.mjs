export async function normalizeFrame(file){
  if(file.size>24000000)throw Error('Файл больше 24 МБ. Выберите снимок экрана или экспорт JPEG.');
  let image,release=()=>{};
  try{image=await createImageBitmap(file,{imageOrientation:'from-image'});release=()=>image.close();}
  catch{
    const objectURL=URL.createObjectURL(file);image=new Image();image.src=objectURL;
    try{await image.decode();}catch{URL.revokeObjectURL(objectURL);throw Error('Safari не смог прочитать изображение. Для HEIC используйте снимок экрана или JPEG.');}
    release=()=>URL.revokeObjectURL(objectURL);
  }
  try{
    const original={width:image.width||image.naturalWidth,height:image.height||image.naturalHeight};
    if(Math.min(original.width,original.height)<80)throw Error('Кадр меньше 80 пикселей. В нём недостаточно деталей.');
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');let scale=Math.min(1,1600/Math.max(original.width,original.height));
    let blob;
    // Never crop or stretch. Keep high JPEG quality; reduce dimensions only for request size.
    for(let attempt=0;attempt<3;attempt++){
      canvas.width=Math.round(original.width*scale);canvas.height=Math.round(original.height*scale);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
      if(blob&&blob.size<=950000)break;scale*=.8;
    }
    if(!blob||blob.size>950000)throw Error('Не удалось передать кадр без чрезмерного уменьшения. Выберите другой кадр.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    return {data,url:URL.createObjectURL(blob),width:canvas.width,height:canvas.height,bytes:blob.size,original,
      warning:Math.min(canvas.width,canvas.height)<300?'Мало деталей: попробуйте более крупный кадр.':scale<.5?'Большой оригинал уменьшен целиком для передачи.':''};
  }finally{release();}
}
