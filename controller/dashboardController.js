const Variant = require('../model/variantProduct');
const Order = require('../model/Order');
const User = require('../model/User');
const moment = require('moment');
const Product = require('../model/Product');

// ────────────────────────────────────────────────────────────────
// Your original full dashboard endpoint (unchanged)
// ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const { period = 'monthly', limit = 5, year } = req.query;  
    
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ msg: 'Invalid period: daily, weekly, or monthly' });
    }

    
    const now = moment();
    const selectedYear = year ? parseInt(year, 10) : now.year();  

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

    
    const [totalProductsAll, fullTotalOrders, totalCustomersAll, totalLifetimeRevenue] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'Customer' }),
      
      Order.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' }}}
      ]).then(results => results[0]?.total || 0)
    ]);

    
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
    const revenueDataPeriod = await Promise.all(revenuePromises);

    
    const { startDate: periodStartDate, endDate: periodEndDate, prevStartDate: periodPrevStartDate, prevEndDate: periodPrevEndDate } = periods[period];
    const [periodOrdersAgg, periodNewCustomers, lowStockAlerts, recentOrders, prevNewCustomers] = await Promise.all([
      
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
      
      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: periodStartDate, $lte: periodEndDate }
      }),
      
      Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name sku')
        .select('sku stockQuantity image product attribute value')
        .sort({ stockQuantity: 1 })
        .limit(4),
        
      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select('orderNumber user items total status createdAt'),
      
      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: periodPrevStartDate, $lte: periodPrevEndDate }
      })
    ]);

    
    const formattedRecentOrders = recentOrders.map(order => ({
      _id: order._id,
      orderId: order.orderNumber?.startsWith('#ORD-') ? order.orderNumber : `#ORD-${String(order._id).slice(-3).padStart(3, '0')}`,
      customer: order.user?.name || 'Unknown',
      product: order.items[0]?.product?.name || 'N/A',
      amount: order.total,
      status: order.status.charAt(0).toUpperCase() + order.status.slice(1),
      date: moment(order.createdAt).format('YYYY-MM-DD')
    }));

    
    const formattedLowStock = lowStockAlerts.map(v => ({
      name: `${v.product?.name || 'N/A'}`,
      sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
      unitsLeft: v.stockQuantity,
      image: v.image || null
    }));

    
    const customerGrowth = prevNewCustomers > 0 ? ((periodNewCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) : 12;
    const productGrowth = '+8%'; // Placeholder; implement historical if needed
    const orderGrowth = '+15%'; // Placeholder

    // ────────────────────────────────────────────────
    //  ADDITIONAL FIELDS – added here without changing original structure
    // ────────────────────────────────────────────────

    // 1. Monthly revenue – now uses selectedYear
    const monthlyRevenueAgg = await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const revenueData = Array(12).fill(0).map((_, i) => {
      const match = monthlyRevenueAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        revenue: match ? Math.round(match.revenue) : 0
      };
    });

    // 2. Monthly order volume – now uses selectedYear
    const monthlyOrderAgg = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const salesTrendData = Array(12).fill(0).map((_, i) => {
      const match = monthlyOrderAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        sales: match ? match.count : 0
      };
    });

    // 3. Monthly new customers – now uses selectedYear
    const monthlyCustomersAgg = await User.aggregate([
      {
        $match: {
          role: 'Customer',
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const customerGrowthData = Array(12).fill(0).map((_, i) => {
      const match = monthlyCustomersAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        customers: match ? match.count : 0
      };
    });

    // 4. Best selling products this month – remains current month only
    const bestSellers = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: now.startOf('month').toDate(), $lte: now.endOf('month').toDate() },
          status: 'delivered'
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          sold: { $sum: '$items.quantity' }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          name: '$product.name',
          sold: '$sold',
          revenue: { $round: ['$revenue', 0] }
        }
      }
    ]);

    const bestSellingProducts = bestSellers.map((p, i) => ({
      name: p.name || 'Unknown',
      sold: p.sold,
      revenue: p.revenue
    }));

    
    const dashboardData = {
      totalProducts: totalProductsAll,
      productGrowth,
      totalOrders: fullTotalOrders,
      orderBreakdown: periodOrdersAgg.breakdown,
      orderGrowth,
      totalCustomers: totalCustomersAll,
      customerGrowth: `${customerGrowth > 0 ? '+' : ''}${customerGrowth}%`,
      revenue: {
        daily: revenueDataPeriod.find(r => r.period === 'Daily'),
        weekly: revenueDataPeriod.find(r => r.period === 'Weekly'),
        monthly: revenueDataPeriod.find(r => r.period === 'Monthly')
      },
      totalLifetimeRevenue: totalLifetimeRevenue,
      revenuePeriod: period.charAt(0).toUpperCase() + period.slice(1),
      lowStockAlerts: formattedLowStock,
      recentOrders: formattedRecentOrders,     
      bestSellingProducts      
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



exports.getRevenueChart = async (req, res) => {
  try {
    const yearStr = req.params.year;
    const selectedYear = yearStr ? parseInt(yearStr, 10) : moment().year();

    if (isNaN(selectedYear) || selectedYear < 2000 || selectedYear > moment().year() + 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid year value"
      });
    }

    const agg = await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const data = Array(12).fill(0).map((_, i) => ({
      month: moment().month(i).format('MMM'),
      revenue: agg.find(m => m._id === i + 1)?.revenue || 0
    }));

    res.json({
      success: true,
      data,
      year: selectedYear
    });
  } catch (error) {
    console.error('getRevenueChart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};


/**
 * GET /api/v1/dashboard/sales-trend/year/:year
 * Returns monthly order volume + YoY % change compared to previous year
 */
exports.getSalesTrend = async (req, res) => {
  try {
    const yearStr = req.params.year;
    const selectedYear = yearStr ? parseInt(yearStr, 10) : moment().year();

    if (isNaN(selectedYear) || selectedYear < 2000 || selectedYear > moment().year() + 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid year value"
      });
    }

    // Current year monthly data
    const currentAgg = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          sales: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const currentTotal = currentAgg.reduce((sum, item) => sum + item.sales, 0);

    // Previous year total (for YoY)
    const prevTotal = await Order.countDocuments({
      createdAt: {
        $gte: moment({ year: selectedYear - 1 }).startOf('year').toDate(),
        $lte: moment({ year: selectedYear - 1 }).endOf('year').toDate()
      }
    });

    let yoyPercentage = 0;
    if (prevTotal > 0) {
      yoyPercentage = ((currentTotal - prevTotal) / prevTotal) * 100;
    } else if (currentTotal > 0) {
      yoyPercentage = 100; // from zero to some value
    }

    const formattedYoY = yoyPercentage >= 0 ? `+${yoyPercentage.toFixed(1)}%` : `${yoyPercentage.toFixed(1)}%`;

    const data = Array(12).fill(0).map((_, i) => {
      const match = currentAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        sales: match ? match.sales : 0
      };
    });

    res.json({
      success: true,
      data,
      year: selectedYear,
      yoyPercentage: formattedYoY,           // ← "+12.5%" or "-3.8%"
      currentYearTotalOrders: currentTotal,
      previousYearTotalOrders: prevTotal
    });
  } catch (error) {
    console.error('getSalesTrend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};


/**
 * GET /api/v1/dashboard/customer-growth/year/:year
 * Returns monthly new customers + YoY % change compared to previous year
 */
exports.getCustomerGrowth = async (req, res) => {
  try {
    const yearStr = req.params.year;
    const selectedYear = yearStr ? parseInt(yearStr, 10) : moment().year();

    if (isNaN(selectedYear) || selectedYear < 2000 || selectedYear > moment().year() + 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid year value"
      });
    }

    // Current year monthly data
    const currentAgg = await User.aggregate([
      {
        $match: {
          role: 'Customer',
          createdAt: {
            $gte: moment({ year: selectedYear }).startOf('year').toDate(),
            $lte: moment({ year: selectedYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          customers: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const currentTotal = currentAgg.reduce((sum, item) => sum + item.customers, 0);

    // Previous year total
    const prevTotal = await User.countDocuments({
      role: 'Customer',
      createdAt: {
        $gte: moment({ year: selectedYear - 1 }).startOf('year').toDate(),
        $lte: moment({ year: selectedYear - 1 }).endOf('year').toDate()
      }
    });

    let yoyPercentage = 0;
    if (prevTotal > 0) {
      yoyPercentage = ((currentTotal - prevTotal) / prevTotal) * 100;
    } else if (currentTotal > 0) {
      yoyPercentage = 100;
    }

    const formattedYoY = yoyPercentage >= 0 ? `+${yoyPercentage.toFixed(1)}%` : `${yoyPercentage.toFixed(1)}%`;

    const data = Array(12).fill(0).map((_, i) => {
      const match = currentAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        customers: match ? match.customers : 0
      };
    });

    res.json({
      success: true,
      data,
      year: selectedYear,
      yoyPercentage: formattedYoY,           // ← "+18.2%" or "-5.4%"
      currentYearTotalCustomers: currentTotal,
      previousYearTotalCustomers: prevTotal
    });
  } catch (error) {
    console.error('getCustomerGrowth error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};