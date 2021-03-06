const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/order');
const CartItem = require('../models/cartItem');
const UserAddress = require('../models/userAddress');
const checkAuth = require('../middleware/check-auth');
const Coupon = require('../models/coupon');
var cron = require('node-cron');
const request = require('request');
const multer = require('multer');
let shiprocketToken;
const Book = require('../models/book');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');


let uploadsingle = multer({
    storage: multerS3({
        s3: s3,
        bucket: 'bbwinvoice',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(null, file.originalname)
        },

    })
});
const options = {
    url: 'https://apiv2.shiprocket.in/v1/external/auth/login',
    json: true,
    method: 'POST',
    body: 
    {
        email: 'aawezk786@gmail.com',
        password: 'aawez123'
    }
    // {
    //     email: 'zewaa99@gmail.com',
    //     password: 'Aawez@123123'
    // }
};
var crypto = require('crypto');
var Razorpay = require('razorpay');
const order = require('../models/order');
let instance = new Razorpay({
    // key_id: 'rzp_live_Ztkdvk7oPSuPCy', 
    // key_secret: 'ooHzXexh9cIX2wXnZbVt3wg1' 
    key_id: 'rzp_test_71mNw1EKfYn4AM', 
    key_secret: 'uUXOT1421l8Zb7Mack8eFAzI' 
  })
  request.post(options, (err, res, body) => {
    if (err) {
        return console.log(err);
    }
    console.log(`Status: ${res.statusCode}`);
    shiprocketToken = body.token;
});

router.post('/create', (req, res, next) => {
    var params = {
                amount: req.query.amount * 100,  
                currency: "INR",
                receipt: req.query.userId,
                payment_capture: '1'
              };
              instance.orders.create(params).then(data=>{
               return res.json({'sub':data,"status":"success","token" : shiprocketToken});
            }).catch(error =>{
                res.send({"sub":error,"status": "failed"})
            });
})

router.post('/Shiprocket-auth',(req,res,next)=>{
     res.status(200).json({
        message : "Success",
        token : shiprocketToken
    })  
});

router.post('/verify', checkAuth, (req, res, next) => {
    let order = new Order({
        _id: new mongoose.Types.ObjectId(),
        user: req.userData.userId,
        order: [{
            orderid: req.query.razorpay_order_id,
            paymentid: req.query.razorpay_payment_id,
            signature: req.query.razorpay_signature,
            book: req.body.book,
            amount: req.body.amount,
            totalitems: req.body.totalitems,
            totalweight: req.body.totalweight,
            address: {
                fullname: req.body.fullname,
                email : req.body.email,
                mobilenumber: req.body.mobilenumber,
                address: req.body.address,
                city: req.body.city,
                pincode: req.body.pincode,
                state: req.body.state
            },
            isCouponApplied: req.body.isCouponApplied,
            coupon_code: req.body.coupon_code
        }],
        isPaymentCompleted: "true"
    })
    body = req.query.razorpay_order_id + "|" + req.query.razorpay_payment_id;
    var expectedSignature = crypto.createHmac('sha256', 'uUXOT1421l8Zb7Mack8eFAzI')
        .update(body.toString())
        .digest('hex');
    console.log("sig" + req.query.razorpay_signature);
    console.log("sig" + expectedSignature);
    var response = { "status": "failure" }
    if (expectedSignature === req.query.razorpay_signature) {
        order.save()
            .then(data => {
                let book = [];
                 book = req.body.book;
                 for (let i = 0; i < book.length; i++) {
                    let bookdetail = book[i]['bookdetail'];
                    console.log(bookdetail)
                    let element = book[i].units;
                    console.log(element)
                    Book.updateOne({_id : bookdetail},{$inc : {quantity : -element}}).then(data=>{console.log(data)}).catch(err=>{console.log(err)})
                    
                }
                Coupon.findOneAndUpdate({ _id: req.body.coupon_code }, { $push: { "user": req.userData.userId } }).exec()
                    .then(result => {
                        res.status(200).json({
                            message: "Order Has been Placed"
                        });
                    })
                    .catch(err => {
                        next(err)
                    });
            })
            .catch(err => {
                next(err)
            });
    } else {
        res.send(response);
    }
});


router.get('/getorders',checkAuth, (req, res, next) => {
    const val = false;
    const userId = req.userData.userId;
    Order.find({"user": userId})
    .select('order  isOrderCompleted isPaymentCompleted orderDate shiporderid shippingid ')
    .populate('order.book.bookdetail', 'book_name sku mrp_inr final_price weight condition')
    .populate('user order.coupon_code')
    .exec()
    .then(orders => {
        
         let orderWithAddress = orders.map(order => {
            console.log(order)
            return {
                _id: order._id,
                user :   order.user,
                order_items: order.order[0].book,
                orderid : order.order[0].orderid,
                paymentid : order.order[0].paymentid,
                amount : order.order[0].amount,
                address: order.order[0].address,
                orderDate: order.orderDate,
                coupon_code : order.order[0].coupon_code,
                isOrderComleted: order.isOrderCompleted,
                isPaymentCompleted: order.isPaymentCompleted,
                shiporderid : order.shiporderid,
                shippingid : order.shippingid
            }
            
        })
        res.status(200).json(
            orderWithAddress
        );
    })
    .catch(error => {
        res.status(500).json({
            error: error
        });
    });
});
router.post('/updateorder/:orderid', (req,res,next) => {
    Order.find({"order.orderid" : req.params.orderid})
    .then(data =>{
        const myquery = {"order.orderid" : req.params.orderid};
        const newvalue = { $set : {"shippingid" : req.query.shippingid,"shiporderid" : req.query.shiporderid}}; 
        Order.updateOne(myquery,newvalue)
        .then(data =>{
            CartItem.deleteOne({user : req.query.userId})
            .then(doc => {doc}).catch(err=>{next(err)});
            res.json({
                message : "Order Updated SuccessFull",
            })
        })
        .catch(err=>{
            next(err)
        });
    })
    .catch(err=>{
        next(err)
    });
});

router.get('/getorderbyid/:orderid', (req, res, next) => {
    Order.find({"order.orderid": req.params.orderid})
    .select('order  isOrderCompleted isPaymentCompleted orderDate shiporderid shippingid ')
    .populate('order.book.bookdetail', 'book_name sku mrp_inr final_price weight condition')
    .populate('user order.coupon_code')
    .exec()
    .then(orders => {
        
         let orderWithAddress = orders.map(order => {
            console.log(order)
            return {
                _id: order._id,
                user :   order.user,
                order_items: order.order[0].book,
                orderid : order.order[0].orderid,
                paymentid : order.order[0].paymentid,
                amount : order.order[0].amount,
                address: order.order[0].address,
                orderDate: order.orderDate,
                coupon_code : order.order[0].coupon_code,
                isOrderComleted: order.isOrderCompleted,
                isPaymentCompleted: order.isPaymentCompleted,
                shiporderid : order.shiporderid,
                shippingid : order.shippingid
            }
            
        })
        res.status(200).json(
            orderWithAddress
        );
    })
    .catch(error => {
        res.status(500).json({
            error: error
        });
    });
});
router.get('/getallorders', (req, res, next) => {
    const val = false;
    const perPage = 20;
    const page = req.query.page - 1;
    Order.find()
    .skip(perPage * page)
    .limit(perPage)
    .select('order  isOrderCompleted isPaymentCompleted orderDate shiporderid shippingid invoiceurl')
    .populate('order.book.bookdetail', 'book_name sku mrp_inr final_price weight condition')
    .populate('user order.coupon_code')
    .exec()
    .then(orders => {
        
        let orderWithAddress = orders.map(order => {
            return {
                _id: order._id,
                user :   order.user,
                order_items: order.order[0].book,
                orderid : order.order[0].orderid,
                paymentid : order.order[0].paymentid,
                amount : order.order[0].amount,
                address: order.order[0].address,
                orderDate: order.orderDate,
                coupon_code : order.order[0].coupon_code,
                isOrderComleted: order.isOrderCompleted,
                isPaymentCompleted: order.isPaymentCompleted,
                shiporderid : order.shiporderid,
                shippingid : order.shippingid,
                invoiceurl : order.invoiceurl,
            }
        })
        var pag = Math.ceil(orders.length / perPage );
      var  pages = Math.ceil(orders.length / perPage)
        if(pag > page){
        res.status(200).json({
            orderWithAddress,
            pages
        }
        );
        }else{
            res.json({
                success: false,
                orders: [],
                pages: 0
            });
        }
    })
    .catch(error => {
        console.log(error)
        next(error)
    });
});
// cron.schedule('* * * * * *', () => {
//     request.post(options, (err, res, body) => {
//         if (err) {
//             return console.log(err);
//         }
//         console.log(`Status: ${res.statusCode}`);
//         shiprocketToken = body.token;
//         console.log(shiprocketToken);
//     });
//   });


router.post('/invoice/:orderId',uploadsingle.single('invoice'),(req,res,next)=>{
    const query = {"order.orderid" : req.params.orderId};
    const newvalue = {$set : {"invoiceurl" : req.file.location}};
    Order.updateOne(query,newvalue)
    .then(data=>{
        res.status(200).json({
            message : "invoice has been uploaded",
            url : req.file.location
        });
    })
    .catch(err=>{
        next(err)
    })
});


module.exports = router;
