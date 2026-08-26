// Auth/User microservice entrypoint — when run standalone (Dockerfile.auth)
// In monolith mode this file is not used; app.js mounts auth.routes directly.
// Standalone: boots minimal Express with only auth routes.
if (process.env.SERVICE==='auth') {
  const express=require('express');
  const { requestId, securityHeaders, cookieParser }=require('../lib/http');
  const app=express();
  app.disable('x-powered-by'); app.set('trust proxy',1);
  app.use(express.json({limit:'8mb'})); app.use(cookieParser); app.use(requestId); app.use(securityHeaders);
  app.use(require('../routes/system.routes'));
  app.use(require('../routes/auth.routes'));
  app.use(require('../routes/org.routes'));
  app.use(require('../routes/verify.routes'));
  const port=process.env.PORT||4001;
  app.listen(port,()=>console.log(`Auth service on :${port}`));
}
module.exports={};
