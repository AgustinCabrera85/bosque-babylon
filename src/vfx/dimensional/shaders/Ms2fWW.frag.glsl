// Seamless polar fractal tunnel study: angular noise sampled in periodic xyz.
// The left-side seam from raw atan() passed into non-periodic fbm() is eliminated.
vec4 renderEffect(vec2 uv){
 vec2 p=screenUV(uv);float t=uTime*uSpeed;
 p+=.12*vec2(sin(t*.31),cos(t*.23));
 float a=atan(p.y,p.x),r=max(.001,length(p));
 float z=1./(r+.095);float twist=a+.5*z+.23*sin(z*1.1+t);
 vec3 cyl=vec3(cos(twist),sin(twist),z);
 float stone=fbm3(cyl*vec3(3.8,3.8,.82)*uScale+vec3(0.,0.,-t*.19));
 float warped=fbm3(cyl*vec3(8.,8.,1.3)+vec3(0.,0.,t*.1));
 float streak=pow(abs(sin(twist*9.+z*2.5-t*1.7)),15.);
 float rings=pow(.5+.5*cos(z*5.4-t*3.2+stone*3.2),6.);
 float contour=sat(.08+stone*.95+warped*.2+streak*.45+rings*.5);
 vec3 col=mix(uColorA*.18,uColorB,contour);
 col*=sat(r*2.1+.12)*(.54+uIntensity*.6);
 col+=vec3(.95,.25,.11)*rings*.23*uIntensity;
 col+=vec3(.02,.006,.02)*pow(1.-sat(r*3.),4.);
 return vec4(col,1.);
}
