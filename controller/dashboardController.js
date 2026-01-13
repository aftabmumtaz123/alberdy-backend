// const Variant = require('../model/variantProduct');
// const Order = require('../model/Order');
// const User = require('../model/User');
// const moment = require('moment');
// const Product = require('../model/Product');

// exports.getDashboard = async (req, res) => {
//   try {
//     const { period = 'monthly', limit = 5 } = req.query;

//     // Validate period
//     if (!['daily', 'weekly', 'monthly'].includes(period)) {
//       return res.status(400).json({ msg: 'Invalid period: daily, weekly, or monthly' });
//     }

//     // Build date filters
//     const now = moment();
//     let startDate, endDate, prevStartDate, prevEndDate;
//     if (period === 'daily') {
//       startDate = now.startOf('day').toDate();
//       endDate = now.endOf('day').toDate();
//       prevStartDate = moment(startDate).subtract(1, 'day').startOf('day').toDate();
//       prevEndDate = moment(startDate).subtract(1, 'day').endOf('day').toDate();
//     } else if (period === 'weekly') {
//       startDate = now.startOf('week').toDate();
//       endDate = now.endOf('week').toDate();
//       prevStartDate = moment(startDate).subtract(1, 'week').startOf('week').toDate();
//       prevEndDate = moment(startDate).subtract(1, 'week').endOf('week').toDate();
//     } else { // monthly
//       startDate = now.startOf('month').toDate();
//       endDate = now.endOf('month').toDate();
//       prevStartDate = moment(startDate).subtract(1, 'month').startOf('month').toDate();
//       prevEndDate = moment(startDate).subtract(1, 'month').endOf('month').toDate();
//     }

//     // All-time totals
//     const [totalProductsAll, fullTotalOrders, totalCustomersAll] = await Promise.all([
//       Product.countDocuments(),
//       Order.countDocuments(),
//       User.countDocuments({ role: 'Customer' })
//     ]);

//     // Period-specific data (parallel queries)
//     const [periodOrdersAgg, periodNewCustomers, lowStockAlerts, recentOrders, currentRevenue, prevRevenue, prevNewCustomers] = await Promise.all([
//       // Period Orders with breakdown (match schema enums: pending, delivered, cancelled; ignore others)
//       Order.aggregate([
//         { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
//         { $group: { _id: '$status', count: { $sum: 1 } } }
//       ]).then(results => {
//         const breakdown = { pending: 0, delivered: 0, cancelled: 0 };
//         results.forEach(r => {
//           if (['pending', 'delivered', 'cancelled'].includes(r._id)) {
//             breakdown[r._id] = r.count;
//           }
//         });
//         const total = results.reduce((sum, r) => sum + r.count, 0);
//         return { total, breakdown };
//       }),

//       // Period New Customers (using User model)
//       User.countDocuments({ 
//         role: 'Customer',
//         createdAt: { $gte: startDate, $lte: endDate } 
//       }),

//       // Low Stock Alerts (stockQuantity < 10)
//     Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
//   .populate('product', 'name sku')          // get product name & sku
//   .select('sku stockQuantity image product attribute value')
//   .sort({ stockQuantity: 1 })
//   .limit(4),
//       // Recent Orders (last N)
//       Order.find()
//         .populate('user', 'name') // Use 'user' ref to 'User'
//         .populate('items.product', 'name')
//         .sort({ createdAt: -1 })
//         .limit(parseInt(limit))
//         .select('orderNumber user items total status createdAt'),

//       // Current Revenue (sum total for delivered orders in period)
//       Order.aggregate([
//         { $match: { 
//           createdAt: { $gte: startDate, $lte: endDate }, 
//           status: 'delivered' 
//         } },
//         { $group: { _id: null, total: { $sum: '$total' } } }
//       ]).then(results => results[0]?.total || 0),

//       // Prev Revenue
//       Order.aggregate([
//         { $match: { 
//           createdAt: { $gte: prevStartDate, $lte: prevEndDate }, 
//           status: 'delivered' 
//         } },
//         { $group: { _id: null, total: { $sum: '$total' } } }
//       ]).then(results => results[0]?.total || 0),

//       // Prev Period New Customers
//       User.countDocuments({ 
//         role: 'Customer',
//         createdAt: { $gte: prevStartDate, $lte: prevEndDate } 
//       })
//     ]);

//     // Recent Orders mapping (match UI: #ORD-001 format if orderNumber is like that; capitalize status)
//     const formattedRecentOrders = recentOrders.map(order => ({
//       orderId: order.orderNumber?.startsWith('#ORD-') ? order.orderNumber : `#ORD-${String(order._id).slice(-3).padStart(3, '0')}`,
//       customer: order.user?.name || 'Unknown',
//       product: order.items[0]?.product?.name || 'N/A',
//       amount: order.total,
//       status: order.status.charAt(0).toUpperCase() + order.status.slice(1),
//       date: moment(order.createdAt).format('YYYY-MM-DD')
//     }));

//     // Low Stock mapping (assume sku exists; fallback if not)
//    const formattedLowStock = lowStockAlerts.map(v => ({
//       name: `${v.product?.name || 'N/A'} (${v.attribute || ''}: ${v.value || ''})`,
//       sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
//       unitsLeft: v.stockQuantity,
//       image: v.image || null
//     }));

//     // Growth Calculations (match UI: +8%, +15%, +12%, +12.5%; use dynamic but fallback to UI values if no prev data)
//     const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 12.5;
//     const customerGrowth = prevNewCustomers > 0 ? ((periodNewCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) : 12;
//     const productGrowth = '+8%'; // Placeholder; implement historical if needed
//     const orderGrowth = '+15%'; // Placeholder

//     const dashboardData = {
//       totalProducts: totalProductsAll,
//       productGrowth,
//       totalOrders: fullTotalOrders,
//       orderBreakdown: periodOrdersAgg.breakdown,
//       orderGrowth,
//       totalCustomers: totalCustomersAll,
//       customerGrowth: `${customerGrowth > 0 ? '+' : ''}${customerGrowth}%`,
//       revenue: currentRevenue,
//       revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
//       revenuePeriod: period.charAt(0).toUpperCase() + period.slice(1),
//       lowStockAlerts: formattedLowStock,
//       recentOrders: formattedRecentOrders
//     };

//     res.json({
//       success: true,
//       msg: "Fetched Successfully",
//       data: dashboardData
//     });
//   } catch (error) {
//     console.error('Dashboard error:', error);
//     res.status(500).json({ error: error.message });
//   }
// };


const Variant = require('../model/variantProduct');
const Order = require('../model/Order');
const User = require('../model/User');
const moment = require('moment');
const Product = require('../model/Product');

exports.getDashboard = async (req, res) => {
  try {
    const { period = 'monthly', limit = 5 } = req.query;
    // Validate period
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ msg: 'Invalid period: daily, weekly, or monthly' });
    }

    // Build date filters for all periods
    const now = moment();
    const periods = {
      daily: {
        startDate: now.startOf('day').toDate(),
        endDate: now.endOf('day').toDate(),
        prevStartDate: moment(now).subtract(1, 'day').startOf('day').toDate(),
        prevEndDate: moment(now).subtract(1, 'day').endOf('day').toDate()
      },
      weekly: {
        startDate: now.startOf('week').toDate(),
        endDate: now.endOf('week').toDate(),
        prevStartDate: moment(now).startOf('week').subtract(1, 'week').toDate(),
        prevEndDate: moment(now).endOf('week').subtract(1, 'week').toDate()
      },
      monthly: {
        startDate: now.startOf('month').toDate(),
        endDate: now.endOf('month').toDate(),
        prevStartDate: moment(now).startOf('month').subtract(1, 'month').toDate(),
        prevEndDate: moment(now).endOf('month').subtract(1, 'month').toDate()
      }
    };

    // All-time totals
    const [totalProductsAll, fullTotalOrders, totalCustomersAll, totalLifetimeRevenue] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'Customer' }),
      // Lifetime Revenue (all delivered orders)
      Order.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } }}
      ]).then(results => results[0]?.total || 0)
    ]);

    // Calculate revenue for all periods in parallel
    const revenuePromises = Object.keys(periods).map(async (p) => {
      const { startDate, endDate, prevStartDate, prevEndDate } = periods[p];
      const [currentRevenue, prevRevenue] = await Promise.all([
        Order.aggregate([
          { $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: 'delivered'
          }},
          { $group: { _id: null, total: { $sum: '$total' } }}
        ]).then(results => results[0]?.total || 0),
        Order.aggregate([
          { $match: {
            createdAt: { $gte: prevStartDate, $lte: prevEndDate },
            status: 'delivered'
          }},
          { $group: { _id: null, total: { $sum: '$total' } }}
        ]).then(results => results[0]?.total || 0)
      ]);
      const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 0;
      return {
        period: p.charAt(0).toUpperCase() + p.slice(1),
        currentRevenue: currentRevenue,
        previousRevenue: prevRevenue,
        growthPercentage: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
        startDate: startDate,
        endDate: endDate
      };
    });
    const revenueData = await Promise.all(revenuePromises);

    // Period-specific data (parallel queries for the requested period)
    const { startDate: periodStartDate, endDate: periodEndDate, prevStartDate: periodPrevStartDate, prevEndDate: periodPrevEndDate } = periods[period];
    const [periodOrdersAgg, periodNewCustomers, lowStockAlerts, recentOrders, prevNewCustomers] = await Promise.all([
      // Period Orders with breakdown (match schema enums: pending, delivered, cancelled; ignore others)
      Order.aggregate([
        { $match: { createdAt: { $gte: periodStartDate, $lte: periodEndDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).then(results => {
        const breakdown = { pending: 0, delivered: 0, cancelled: 0 };
        results.forEach(r => {
          if (['pending', 'delivered', 'cancelled'].includes(r._id)) {
            breakdown[r._id] = r.count;
          }
        });
        const total = results.reduce((sum, r) => sum + r.count, 0);
        return { total, breakdown };
      }),
      // Period New Customers (using User model)
      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: periodStartDate, $lte: periodEndDate }
      }),
      // Low Stock Alerts (stockQuantity < 10)
      Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name sku')
        .select('sku stockQuantity image product attribute value')
        .sort({ stockQuantity: 1 })
        .limit(4),
      // Recent Orders (last N)
      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select('orderNumber user items total status createdAt'),
      // Prev Period New Customers
      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: periodPrevStartDate, $lte: periodPrevEndDate }
      })
    ]);

    // Recent Orders mapping (match UI: #ORD-001 format if orderNumber is like that; capitalize status)
    const formattedRecentOrders = recentOrders.map(order => ({
      _id: order._id,
      orderId: order.orderNumber?.startsWith('#ORD-') ? order.orderNumber : `#ORD-${String(order._id).slice(-3).padStart(3, '0')}`,
      customer: order.user?.name || 'Unknown',
      product: order.items[0]?.product?.name || 'N/A',
      amount: order.total,
      status: order.status.charAt(0).toUpperCase() + order.status.slice(1),
      date: moment(order.createdAt).format('YYYY-MM-DD')
    }));

    // Low Stock mapping (assume sku exists; fallback if not)
    const formattedLowStock = lowStockAlerts.map(v => ({
      name: `${v.product?.name || 'N/A'}`,
      sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
      unitsLeft: v.stockQuantity,
      image: v.image || null
    }));

    // Growth Calculations for the requested period
    const customerGrowth = prevNewCustomers > 0 ? ((periodNewCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) : 12;
    const productGrowth = '+8%'; // Placeholder; implement historical if needed
    const orderGrowth = '+15%'; // Placeholder

    // Dashboard data with separate revenue objects and lifetime revenue
    const dashboardData = {
      totalProducts: totalProductsAll,
      productGrowth,
      totalOrders: fullTotalOrders,
      orderBreakdown: periodOrdersAgg.breakdown,
      orderGrowth,
      totalCustomers: totalCustomersAll,
      customerGrowth: `${customerGrowth > 0 ? '+' : ''}${customerGrowth}%`,
      revenue: {
        daily: revenueData.find(r => r.period === 'Daily'),
        weekly: revenueData.find(r => r.period === 'Weekly'),
        monthly: revenueData.find(r => r.period === 'Monthly')
      },
      totalLifetimeRevenue: totalLifetimeRevenue,
      revenuePeriod: period.charAt(0).toUpperCase() + period.slice(1),
      lowStockAlerts: formattedLowStock,
      recentOrders: formattedRecentOrders
    };

    res.json({
      success: true,
      msg: "Fetched Successfully",
      data: dashboardData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
};

