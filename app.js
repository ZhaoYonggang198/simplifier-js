const _ = require('koa-route');
const Koa = require('koa');
const app = new Koa();
const log4js = require('log4js');
const koaBody = require('koa-body');

log4js.configure({
    appenders: {
      out: { type: 'stdout' },
      app: { type: 'file', filename: 'logs/access.log' }
    },
    categories: {
      default: { appenders: [ 'out', 'app' ], level: 'debug' }
    }
});

var logger = log4js.getLogger()

const grpc = require('grpc')
const protoLoader = require('@grpc/proto-loader')
const grpc_promise = require('grpc-promise')
 

const config = require('./config.json')


const packageDefinition = protoLoader.loadSync(
  __dirname + '/tensorflow_serving/apis/prediction_service.proto',
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
)

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const tensorflow_serving = protoDescriptor.tensorflow.serving;



class Predict {
  constructor() {
    const [ hanzi_2_index, index_2_hanzi, dummy ] = require('./data/w2v.json')
    this.hanzi_2_index = hanzi_2_index
    this.index_2_hanzi = index_2_hanzi
    this.client = new tensorflow_serving.PredictionService(config.tensorflow_serving, grpc.credentials.createInsecure())
    grpc_promise.promisifyAll(this.client)
  }

  async imply(request) {
    const input = request.split("").map(item => this.hanzi_2_index[item])
    return await this.client.Predict().sendMessage({
      model_spec: {
        name: "simplifier"
      },
      inputs: {
        in: { 
          dtype: 'DT_INT32',
          tensor_shape: {
            dim: [{ size: 1},
                 { size: input.length}]
          },
          int_val: input
        }
      }
    }).then(res => {
      const  output = res.outputs.out.int_val
      return output.filter(item => item !== 7267).map(item => this.index_2_hanzi[item]).join("")
    }).catch(err => {
      logger.error('error occur ', err.message)
    })
  }
}

const predictor = new Predict()

const predict = async (ctx) => {
  try {
    const result = await predictor.imply(ctx.request.body.x)
    logger.debug(`simplify executed {request: "${ctx.request.body.x}", response: "${result}"}`, )
    ctx.response.type = "application/json"
    ctx.response.status = 200
    ctx.response.body = {y:result}
  } catch (err) {
    ctx.response.status = 404;
    ctx.response.type = "application/json";
    ctx.response.body = {error: err.toString()};
  }
}

app.use(async (ctx, next) => {
  logger.debug(`process request for '${ctx.request.method} ${ctx.request.url}' ...`);
  var start = new Date().getTime();
  await next();
  var execTime = new Date().getTime() - start;
  ctx.response.set('X-Response-Time', `${execTime}ms`); 
  logger.debug(`... response in duration ${execTime}ms`);
  if (execTime > 1000) {
    logger.error(`... response in duration ${execTime}ms`)
  }
})

app.use(koaBody())
app.use(_.post('/api/predict', predict))

app.listen(config.port)

logger.info('listen on ', config.port)