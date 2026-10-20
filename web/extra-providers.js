// Exact public page routes from the pinned research. No Lampac stream extraction,
// injected SDK, borrowed tokens, advertising changes or network interception.
export const EXTRA_FRAMES=[
 {key:'autoembedapp',name:'Autoembed.app',refId:'C27',origin:'https://player.autoembed.app',grammar:'slash',source:'https://autoembed.app/#api'},
 {key:'autoembedto',name:'AutoEmbed · player.autoembed.to',refId:'L011',origin:'https://player.autoembed.to',grammar:'slash',adapter:'AutoEmbed'},
 {key:'hydraflix',name:'HydraFlix · vidfast.vc',refId:'L012',origin:'https://vidfast.vc',grammar:'plain',adapter:'HydraFlix'},
 {key:'movpi',name:'MovPI · moviesapi.to',refId:'L013',origin:'https://moviesapi.to',grammar:'movpi',adapter:'MovPI'},
 {key:'playembed',name:'PlayEmbed · vidora.su',refId:'L014',origin:'https://vidora.su',grammar:'plain',adapter:'PlayEmbed'},
 {key:'rgshows',name:'RgShows',refId:'L015',origin:'https://api.rgshows.me',grammar:'rgshows',adapter:'RgShows'},
 {key:'smashy',name:'SmashyStream · anyembed.xyz',refId:'L016',origin:'https://anyembed.xyz',grammar:'smashy',adapter:'SmashyStream'},
 {key:'twoembed',name:'TwoEmbed',refId:'L017',origin:'https://www.2embed.cc',grammar:'slash',adapter:'TwoEmbed'},
 {key:'vidsrcpm',name:'VidSrc · vidsrc.pm',refId:'L018',origin:'https://vidsrc.pm',grammar:'vidsrcpm',adapter:'VidSrc'},
 {key:'videasy',name:'Videasy',refId:'L019',origin:'https://player.videasy.to',grammar:'plain',adapter:'Videasy'},
];
export const RESEARCH_SHA='b7ec8e2f1b9bf6fc9a5620d09740eac8f0aed6f3';
export function extraPath(grammar,{type,id,season,episode}){
 const suffix=type==='movie'?`movie/${id}`:`tv/${id}/${season}/${episode}`;
 if(grammar==='movpi')return type==='movie'?`/movie/${id}`:`/tv/${id}-${season}-${episode}`;
 if(grammar==='rgshows')return `/main/${suffix}`;
 if(grammar==='smashy')return type==='movie'?`/embed/tmdb-movie-${id}`:`/embed/tmdb-tv-${id}-${season}-${episode}`;
 if(grammar==='vidsrcpm')return `/v2/embed/${suffix}`;
 return null;
}
