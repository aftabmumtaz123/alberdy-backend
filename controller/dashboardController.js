const Variant = require('../model/variantProduct');
const Order = require('../model/Order');
const User = require('../model/User');
const Product = require('../model/Product');
const moment = require('moment');

exports.getDashboard = async (req, res) => {
  try {
    const { 
      period = 'monthly', 
      limit = 5,
      year = moment().year().toString()
    } = req.query;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ msg: 'Invalid period: daily, weekly, or monthly' });
    }

    const now = moment();
    const currentYear = parseInt(year, 10);

    // ────────────────────────────────────────────────
    // Period ranges
    // ────────────────────────────────────────────────
    const periods = {
      daily: {
        start: now.startOf('day').toDate(),
        end: now.endOf('day').toDate(),
        prevStart: moment(now).subtract(1, 'day').startOf('day').toDate(),
        prevEnd: moment(now).subtract(1, 'day').endOf('day').toDate()
      },
      weekly: {
        start: now.startOf('week').toDate(),
        end: now.endOf('week').toDate(),
        prevStart: moment(now).startOf('week').subtract(1, 'week').toDate(),
        prevEnd: moment(now).endOf('week').subtract(1, 'week').toDate()
      },
      monthly: {
        start: now.startOf('month').toDate(),
        end: now.endOf('month').toDate(),
        prevStart: moment(now).startOf('month').subtract(1, 'month').toDate(),
        prevEnd: moment(now).endOf('month').subtract(1, 'month').toDate()
      }
    };

    const { start, end, prevStart, prevEnd } = periods[period];

    // ────────────────────────────────────────────────
    // Lifetime stats
    // ────────────────────────────────────────────────
    const [totalProducts, totalOrders, totalCustomers, lifetimeRevenue] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'Customer' }),
      Order.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0)
    ]);

    // ────────────────────────────────────────────────
    // Period revenue (daily / weekly / monthly)
    // ────────────────────────────────────────────────
    const periodRevenueStats = await Promise.all(
      Object.keys(periods).map(async (key) => {
        const p = periods[key];
        const [current, previous] = await Promise.all([
          Order.aggregate([
            { $match: { createdAt: { $gte: p.start, $lte: p.end }, status: 'delivered' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
          ]).then(r => r[0]?.total || 0),
          Order.aggregate([
            { $match: { createdAt: { $gte: p.prevStart, $lte: p.prevEnd }, status: 'delivered' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
          ]).then(r => r[0]?.total || 0)
        ]);

        const growth = previous > 0 ? ((current - previous) / previous * 100) : 0;

        return {
          period: key.charAt(0).toUpperCase() + key.slice(1),
          current,
          previous,
          growth: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`
        };
      })
    );

    // ────────────────────────────────────────────────
    // Monthly order volume (Sales Trends line chart)
    // ────────────────────────────────────────────────
    const monthlyOrderVolumeAgg = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: moment({ year: currentYear }).startOf('year').toDate(),
            $lte: moment({ year: currentYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const volumes = Array(12).fill(0);
    monthlyOrderVolumeAgg.forEach(item => {
      volumes[item._id - 1] = item.count;
    });

    const prevYearTotalOrders = await Order.countDocuments({
      createdAt: {
        $gte: moment({ year: currentYear - 1 }).startOf('year').toDate(),
        $lte: moment({ year: currentYear - 1 }).endOf('year').toDate()
      }
    });

    const currentYearTotal = volumes.reduce((a, b) => a + b, 0);
    const volumeGrowth = prevYearTotalOrders > 0 
      ? ((currentYearTotal - prevYearTotalOrders) / prevYearTotalOrders * 100).toFixed(1) 
      : currentYearTotal > 0 ? 100 : 0;

    const salesTrendData = volumes.map((sales, i) => ({
      month: moment().month(i).format('MMM'),
      sales
    }));

    // ────────────────────────────────────────────────
    // Monthly revenue this year (bar chart)
    // ────────────────────────────────────────────────
    const monthlyRevenueAgg = await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: {
            $gte: moment({ year: currentYear }).startOf('year').toDate(),
            $lte: moment({ year: currentYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const revenueData = Array(12).fill(0).map((_, i) => {
      const match = monthlyRevenueAgg.find(m => m._id === i + 1);
      return {
        month: moment().month(i).format('MMM'),
        revenue: match ? Math.round(match.revenue) : 0
      };
    });

    // ────────────────────────────────────────────────
    // Monthly new customers (Customer Growth chart)
    // ────────────────────────────────────────────────
    const monthlyCustomersAgg = await User.aggregate([
      {
        $match: {
          role: 'Customer',
          createdAt: {
            $gte: moment({ year: currentYear }).startOf('year').toDate(),
            $lte: moment({ year: currentYear }).endOf('year').toDate()
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const customerGrowthData = Array(12).fill(0).map((_, i) => ({
      month: moment().month(i).format('MMM'),
      customers: monthlyCustomersAgg.find(m => m._id === i + 1)?.count || 0
    }));

    // ────────────────────────────────────────────────
    // Best sellers THIS MONTH
    // ────────────────────────────────────────────────
    const monthStart = moment().startOf('month').toDate();
    const monthEnd = moment().endOf('month').toDate();

    const bestSellersAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: monthStart, $lte: monthEnd }, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          units: { $sum: '$items.quantity' }
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
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: { $ifNull: ['$product.name', 'Unknown Product'] },
          revenue: { $round: ['$revenue', 0] },
          sold: '$units'
        }
      }
    ]);

    const bestSellingProducts = bestSellersAgg.map((p, i) => ({
      rank: i + 1,
      name: p.name,
      sold: p.sold,
      revenue: p.revenue,
      label: 'Top performer'
    }));

    // ────────────────────────────────────────────────
    // Period-specific + other widgets
    // ────────────────────────────────────────────────
    const [periodOrdersAgg, newCustomers, prevNewCustomers, lowStock, recentOrders] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
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

      User.countDocuments({ role: 'Customer', createdAt: { $gte: start, $lte: end } }),

      User.countDocuments({ role: 'Customer', createdAt: { $gte: prevStart, $lte: prevEnd } }),

      Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name')
        .select('sku stockQuantity product')
        .sort({ stockQuantity: 1 })
        .limit(4),

      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .select('orderNumber user items total status createdAt')
    ]);

    const customerGrowthPct = prevNewCustomers > 0 
      ? ((newCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1)
      : newCustomers > 0 ? 100 : 0;

    // ────────────────────────────────────────────────
    // Final response
    // ────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        totalProducts,
        totalOrders,
        totalCustomers,
        lifetimeRevenue,

        revenue: periodRevenueStats.reduce((acc, item) => {
          acc[item.period.toLowerCase()] = item;
          return acc;
        }, {}),

        revenueData,              // for Monthly Revenue Overview bar chart
        salesTrendData,           // for Sales Trends line chart
        customerGrowthData,       // for Customer Growth line chart
        bestSellingProducts,      // clean best sellers

        // Backward compatibility (optional – keep if frontend still uses these)
        salesTrends: {
          year: currentYear,
          months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          volumes,
          growth: volumeGrowth >= 0 ? `+${volumeGrowth}%` : `${volumeGrowth}%`
        },
        bestSellers: bestSellingProducts, // alias

        period: period.charAt(0).toUpperCase() + period.slice(1),
        periodOrders: periodOrdersAgg,
        newCustomersThisPeriod: newCustomers,
        customerGrowth: `${customerGrowthPct >= 0 ? '+' : ''}${customerGrowthPct}%`,

        lowStockAlerts: lowStock.map(v => ({
          name: v.product?.name || 'Unknown',
          sku: v.sku || '—',
          unitsLeft: v.stockQuantity
        })),

        recentOrders: recentOrders.map(o => ({
          orderId: o.orderNumber || `#${String(o._id).slice(-6)}`,
          customer: o.user?.name || 'Guest',
          product: o.items?.[0]?.product?.name || 'Multiple items',
          amount: o.total,
          status: o.status,
          date: moment(o.createdAt).format('YYYY-MM-DD')
        }))
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};