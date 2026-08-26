if (process.env.SERVICE==='marketplace') {
  const express=require('express');
  const { requestId, securityHeaders, cookieParser }=require('../lib/http');
  const { rateLimiter, byIp }=require('../lib/rateLimit');
  const app=express();
  app.disable('x-powered-by'); app.set('trust proxy',1);
  app.use(express.json({limit:'8mb'})); app.use(cookieParser); app.use(requestId); app.use(securityHeaders);
  app.use('/api', rateLimiter({windowMs:60*1000,max:300,keyFn:byIp}));
  app.use(require('../routes/system.routes'));
  app.use(require('../routes/jobs.routes'));
  app.use(require('../routes/bids.routes'));
  app.use(require('../routes/job-lifecycle.routes'));
  app.use(require('../routes/job-extras.routes'));
  app.use(require('../routes/location.routes'));
  app.use(require('../routes/telematics.routes'));
  app.use(require('../routes/edi.routes'));
  app.use(require('../routes/rfp.routes'));
  app.use(require('../routes/enterprise.routes'));
  app.use(require('../routes/currency.routes'));
  const port=process.env.PORT||4002;
  app.listen(port,()=>console.log(`Marketplace service on :${port}`));
}
module.exports={};
