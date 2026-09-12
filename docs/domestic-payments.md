# 国内积分充值接入

已实现：支付宝电脑网站支付、微信支付 API v3 Native 扫码、银联全渠道网关支付。代码直接使用 Node.js crypto，不引入 PHP/Java 运行时，不经过 Stripe 或个人收款码聚合平台。

## 开通前配置

在服务端秘密管理系统或本地不入库的环境文件中配置以下变量。不要填写到前端，也不要把私钥发到聊天中。配置后由部署操作者按现有流程加载环境；本次没有重启或部署服务。

| 变量                          | 含义                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `PAYMENT_PUBLIC_BASE_URL`     | 公网 HTTPS 平台地址，包含挂载前缀，例如 `https://你的域名/lobehub`；不带查询参数        |
| `PAYMENT_CNY_FEN_PER_MILLION` | 每 100 万积分的人民币售价，整数分。必须由经营者确认；没有默认值，不使用展示汇率自动定价 |
| `ALIPAY_APP_ID`               | 已开通电脑网站支付的应用 ID                                                             |
| `ALIPAY_SELLER_ID`            | 收款支付宝商户 UID                                                                      |
| `ALIPAY_PRIVATE_KEY`          | 应用 RSA2 私钥（PEM）                                                                   |
| `ALIPAY_PUBLIC_KEY`           | 从支付宝开放平台取得的支付宝公钥（不是应用公钥）                                        |
| `WECHAT_PAY_APP_ID`           | 与商户号绑定的 AppID                                                                    |
| `WECHAT_PAY_MERCHANT_ID`      | 已开通 Native 支付的商户号                                                              |
| `WECHAT_PAY_PRIVATE_KEY`      | 商户 API 证书 RSA 私钥（PEM）                                                           |
| `WECHAT_PAY_SERIAL_NO`        | 商户 API 证书序列号                                                                     |
| `WECHAT_PAY_API_V3_KEY`       | 32 字节 API v3 密钥，用于通知解密                                                       |
| `WECHAT_PAY_PUBLIC_KEY`       | 微信支付平台公钥（PEM）                                                                 |
| `WECHAT_PAY_PUBLIC_KEY_ID`    | 对应的微信支付公钥 ID，本实现采用公钥模式                                               |
| `UNIONPAY_MERCHANT_ID`        | 已开通全渠道网关支付的银联商户号                                                        |
| `UNIONPAY_CERT_ID`            | 银联商户签名证书序列号（十进制）                                                        |
| `UNIONPAY_PRIVATE_KEY`        | 商户签名证书对应的 RSA 私钥（转换为 PEM）                                               |
| `UNIONPAY_PUBLIC_KEY`         | 经官方渠道验证后配置的银联验签公钥（PEM）                                               |

PEM 支持真实换行或转义的 `\n`。密钥须为 RSA 2048 位或以上；轮换平台公钥时同步更新配置。本实现不信任通知自行携带的银联证书，避免攻击者替换验签信任根。

支付宝证书模式、微信服务商模式/H5/小程序、银联其他产品不属于本次接入。Native 二维码需要微信扫码；网银可用的银行与选项以银联商户开通产品及实际网关页面为准。这里不采集银行卡号或银行密码。

## 通知地址

以 `PAYMENT_PUBLIC_BASE_URL` 为前缀，服务端下单自动提交：

- `/api/payments/alipay/notify`
- `/api/payments/wechat/notify`
- `/api/payments/unionpay/notify`

通知地址须公网可访问，不能经过登录重定向、验证码或静态页面重写。银联前台 POST 返回经 `/api/payments/unionpay/return` 转为 303 回到积分页；它不会修改订单或积分。

## 订单与账务

- 新收银台在服务端计算 CNY 应付金额；前端回传金额仅用于确认报价，没有定价权限。旧 USD 订单和原始模型成本不变，旧订单不能直接拿到国内通道付款。
- 用户选择通道、确认充值后才建订单。通道绑定在服务端产品快照中，重试复用同一个订单号，不能跨通道重复支付。
- 先持久化 `payment_pending` 再调用网关。超时不能当作付款失败，也不自动重新生成订单。
- 回调验签、商户身份校验、金额/币种核对通过后，在数据库事务里记录支付事件、增加余额、生成 `top_up` 流水并更新订单。订单锁、事件唯一索引和账本幂等键共同防止重复入账。
- 金额不符、重复付款身份不符等异常进入人工核对，不自动加积分或退款。
- 发起支付后不提供仅修改本地状态的“取消”按钮。关闭弹窗不取消订单；支付时限为 30 分钟，已付款但通知延迟的订单仍由可信通知处理。
- 前端每 3 秒查询当前订单，关闭弹窗停止轮询；到账后刷新余额、积分明细和订单列表。不把浏览器返回参数或用户点击“已支付”当作付款证据。

## 必须完成的商户联调

当前检查只证明本地协议、验签、账本和界面行为，不代表已通过三个平台的商户验收。没有注入真实商户凭据，没有真实收款、退款或生产部署。

启用前在独立测试环境确认：商户产品权限、签名/证书、回调公网连通、真实付款金额、重复通知、支付超时、用户关闭页面后到账，以及各通道退款/对账运营流程。网关/WAF 应对通知接口配置请求体上限和限流。需要自动退款、定期主动查单或平台公钥自动轮换时，应作为后续明确功能接入，不能伪装成当前已具备。

## 源码参考

- [yansongda/pay 银联网关](https://github.com/yansongda/pay/blob/master/src/Plugin/Unipay/Open/Pay/Web/PayPlugin.php)
- [yansongda/pay 银联签名](https://github.com/yansongda/pay/blob/master/src/Traits/UnipayTrait.php)
- [支付宝官方 Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all)
- [微信支付官方 SDK](https://github.com/wechatpay-apiv3/wechatpay-java)
- [Jeepay 支付订单](https://github.com/jeequan/jeepay/blob/master/jeepay-service/src/main/java/com/jeequan/jeepay/service/impl/PayOrderService.java)

仅参考接口协议及流程；未复制 Jeepay 的 LGPL 实现。本次不新增第三方支付依赖。
