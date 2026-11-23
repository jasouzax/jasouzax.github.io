/* Scene reading remains a scrolling article in both orientations and every skin. */
export const blog_css = `
.desk[data-blog-scenes] { display:block!important; overflow:visible; height:auto; padding:1rem; }
.desk[data-blog-scenes] > .desk_side { position:relative; width:100%; margin:0 0 1rem; }
.desk[data-blog-scenes] > .desk_wbox { position:relative; grid-area:auto!important; width:100%; min-height:18rem; margin:1rem 0; }
.desk[data-blog-scenes] > .desk_wbox:not([hidden]) { display:flex!important; flex-direction:column; }
.desk[data-blog-scenes] > .desk_gap { display:none; }
.blog_scene_heading { margin:2rem 0 1rem; overflow-wrap:anywhere; }
.blog_scene_heading p { white-space:pre-wrap; }
.blog_scene_heading img { max-width:100%; max-height:32rem; object-fit:contain; }
.blog_media { margin:1rem auto; max-width:60rem; }
.blog_media canvas { display:block; width:100%; aspect-ratio:16/9; background:#101827; }
.blog_media_controls { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; padding:.75rem 0; }
.blog_media_controls label { display:flex; gap:.5rem; flex:1; align-items:center; }
.blog_media_controls input { min-width:5rem; width:100%; }
.blog_media_controls button { padding:.5rem .75rem; }
.blog_media_controls output { flex-basis:100%; }
@media print { .blog_media { display:none; } }
`
