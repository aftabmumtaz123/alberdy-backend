const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const Variant = require('./model/variantProduct');
require('dotenv').config();
const categoryRoutes = require('./router/categories');
const productRoutes = require('./router/products');
const morgan = require('morgan');
const app = express();
const PORT = process.env.PORT || 5000;
const cookieParser = require('cookie-parser'); 

const checkExpiredVariants = require('./jobs/checkExpiredVarients');

checkExpiredVariants();

app.use(express.json());
app.use(cookieParser()); 
app.use(express.urlencoded({ extended: true }));

app.use(morgan('dev'));
app.use(cors());
app.set('trust proxy', 1);



const Offer = require('./model/Offer');

cron.schedule('0 0 * * *', async () => {
  try {
    await Offer.updateExpiredOffers();
    await Variant.updateExpiredVariants();
    const now = new Date();
    const productsWithEntries = await StockEntry.distinct('product');
    for (const prodId of productsWithEntries) {
      const currentStock = await calculateCurrentStock(prodId);
      await Product.findByIdAndUpdate(prodId, { stockQuantity: currentStock });
    }
    console.log('Daily stock recalculation and variant status update completed at', new Date());
  } catch (error) {
    console.error('Cron job failed:', error);
  }
});


app.use(express.json());
app.use(cookieParser()); 
app.use(express.urlencoded({ extended: true }));


const connection = require('./config/db'); 
connection();

// Routes
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/brands', require('./router/brand'));
app.use('/api/v1/categories', categoryRoutes); 
app.use('/api/v1/subcategories', require('./router/subcategories')); 
app.use('/api/v1/auth', require("./router/resetPassword"))
app.use('/api/v1/units', require('./router/unit'));
app.use('/api/v1/customers', require('./router/customer'));
app.use('/api/v1/expenses', require('./router/expense')); 
app.use('/api/v1/expense-categories', require('./router/expenseCategory')); 
app.use('/api/v1/currencies', require('./router/currency')); 
app.use('/api/v1/configuration', require('./router/appConfigurationRouter')); 
app.use('/api/v1/dashboard', require('./router/dashboard'));
app.use('/api/v1/offer', require('./router/offer'));
app.use('/api/v1/orders', require('./router/orderRouter')); 
app.use('/api/v1/contact', require("./router/contactUs")) 
app.use('/', require('./router/authRouter')); 
app.use('/api/v1/variants', require('./router/variant'));
app.use('/api/v1/report', require('./router/reportsRouter'))
app.use('/api/v1/purchases', require('./router/purchaseRouter'));
app.use('/api/v1/suppliers', require('./router/supplierRouter')); 
app.use('/api/v1/sales', require('./router/saleRouter'));
app.use('/api/v1/supllier/payments', require('./router/paymentRoutes'))
app.use('/api/v1/customer-payments', require('./router/customerPaymentRoutes'));
app.use('/api/v1/inventory', require('./router/inventoryRoutes'));
app.use('/api/v2/banner', require('./router/bannerRoute'))


app.use('/api/push', require('./router/push')); 


app.get("/",(req,res)=>{
  res.json({Message: "API's are running well bro!!"})
})

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));