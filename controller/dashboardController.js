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

    // Build date filters for current and previous periods
    const now = moment().tz('Asia/Karachi'); // Use PKT timezone
    const startOfDay = now.startOf('day');
    const startOfWeek = now.startOf('week'); // Monday-based week
    const startOfMonth = now.startOf('month');

    // Define date ranges
    const dailyStart = startOfDay.toDate();
    const dailyEnd = now.toDate();
    const weeklyStart = startOfWeek.toDate();
    const weeklyEnd = now.toDate();
    const monthlyStart = startOfMonth.toDate();
    const monthlyEnd = now.toDate();

    const prevDailyStart = moment(dailyStart).subtract(1, 'day').startOf('day').toDate();
    const prevDailyEnd = moment(dailyStart).subtract(1, 'day').endOf('day').toDate();
    const prevWeeklyStart = moment(weeklyStart).subtract(1, 'week').startOf('week').toDate();
    const prevWeeklyEnd = moment(weeklyStart).subtract(1, 'week').endOf('week').toDate();
    const prevMonthlyStart = moment(monthlyStart).subtract(1, 'month').startOf('month').toDate();
    const prevMonthlyEnd = moment(monthlyStart).subtract(1, 'month').endOf('month').toDate();

    // All-time totals
    const [totalProductsAll, fullTotalOrders, totalCustomersAll] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'Customer' })
    ]);

    // Revenue calculations for daily, weekly, monthly
    const [dailyRevenue, weeklyRevenue, monthlyRevenue, prevDailyRevenue, prevWeeklyRevenue, prevMonthlyRevenue] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: dailyStart, $lte: dailyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: weeklyStart, $lte: weeklyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: monthlyStart, $lte: monthlyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: prevDailyStart, $lte: prevDailyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: prevWeeklyStart, $lte: prevWeeklyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: prevMonthlyStart, $lte: prevMonthlyEnd }, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' } } }
      ]).then(results => results[0]?.revenue || 0)
    ]);

    // Period-specific data (parallel queries)
    const [periodOrdersAgg, periodNewCustomers, lowStockAlerts, recentOrders, prevNewCustomers] = await Promise.all([
      // Period Orders with breakdown
      Order.aggregate([
        { $match: { createdAt: { $gte: (period === 'daily' ? dailyStart : period === 'weekly' ? weeklyStart : monthlyStart), $lte: (period === 'daily' ? dailyEnd : period === 'weekly' ? weeklyEnd : monthlyEnd) } } },
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

      // Period New Customers
      User.countDocuments({ 
        role: 'Customer',
        createdAt: { $gte: (period === 'daily' ? dailyStart : period === 'weekly' ? weeklyStart : monthlyStart), $lte: (period === 'daily' ? dailyEnd : period === 'weekly' ? weeklyEnd : monthlyEnd) } 
      }),

      // Low Stock Alerts
      Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name sku')
        .select('sku stockQuantity image product attribute value')
        .sort({ stockQuantity: 1 })
        .limit(4),

      // Recent Orders
      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select('orderNumber user items total status createdAt'),

      // Prev Period New Customers
      User.countDocuments({ 
        role: 'Customer',
        createdAt: { $gte: (period === 'daily' ? prevDailyStart : period === 'weekly' ? prevWeeklyStart : prevMonthlyStart), $lte: (period === 'daily' ? prevDailyEnd : period === 'weekly' ? prevWeeklyEnd : prevMonthlyEnd) } 
      })
    ]);

    // Recent Orders mapping
    const formattedRecentOrders = recentOrders.map(order => ({
      orderId: order.orderNumber?.startsWith('#ORD-') ? order.orderNumber : `#ORD-${String(order._id).slice(-3).padStart(3, '0')}`,
      customer: order.user?.name || 'Unknown',
      product: order.items[0]?.product?.name || 'N/A',
      amount: order.total,
      status: order.status.charAt(0).toUpperCase() + order.status.slice(1),
      date: moment(order.createdAt).format('YYYY-MM-DD')
    }));

    // Low Stock mapping
    const formattedLowStock = lowStockAlerts.map(v => ({
      name: `${v.product?.name || 'N/A'} (${v.attribute || ''}: ${v.value || ''})`,
      sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
      unitsLeft: v.stockQuantity,
      image: v.image || null
    }));

    // Growth Calculations
    const revenueGrowth = (period === 'daily' ? prevDailyRevenue : period === 'weekly' ? prevWeeklyRevenue : prevMonthlyRevenue) > 0
      ? (((period === 'daily' ? dailyRevenue : period === 'weekly' ? weeklyRevenue : monthlyRevenue) - 
          (period === 'daily' ? prevDailyRevenue : period === 'weekly' ? prevWeeklyRevenue : prevMonthlyRevenue)) / 
          (period === 'daily' ? prevDailyRevenue : period === 'weekly' ? prevWeeklyRevenue : prevMonthlyRevenue) * 100).toFixed(1)
      : 12.5;
    const customerGrowth = prevNewCustomers > 0 ? ((periodNewCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) : 12;
    const productGrowth = '+8%'; // Placeholder
    const orderGrowth = '+15%'; // Placeholder

    const revenueData = {
      daily: { revenue: dailyRevenue },
      weekly: { revenue: weeklyRevenue },
      monthly: { revenue: monthlyRevenue }
    };

    const dashboardData = {
      totalProducts: totalProductsAll,
      productGrowth,
      totalOrders: fullTotalOrders,
      orderBreakdown: periodOrdersAgg.breakdown,
      orderGrowth,
      totalCustomers: totalCustomersAll,
      customerGrowth: `${customerGrowth > 0 ? '+' : ''}${customerGrowth}%`,
      revenue: revenueData, // Structured revenue object
      revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
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