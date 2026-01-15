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
      year = moment().year()   // for sales trends & revenue chart
    } = req.query;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ msg: 'Invalid period: daily, weekly, or monthly' });
    }

    const now = moment();
    const currentYear = parseInt(year);

    // ────────────────────────────────────────────────
    //  Period definitions (current + previous)
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
    //  Basic counters (lifetime)
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
    //  Revenue for each granularity (daily/weekly/monthly)
    // ────────────────────────────────────────────────
    const revenueData = await Promise.all(
      Object.keys(periods).map(async (key) => {
        const p = periods[key];
        const [curr, prev] = await Promise.all([
          Order.aggregate([
            { $match: { createdAt: { $gte: p.start, $lte: p.end }, status: 'delivered' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
          ]).then(r => r[0]?.total || 0),

          Order.aggregate([
            { $match: { createdAt: { $gte: p.prevStart, $lte: p.prevEnd }, status: 'delivered' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
          ]).then(r => r[0]?.total || 0)
        ]);

        const growth = prev > 0 ? ((curr - prev) / prev * 100).toFixed(1) : 0;

        return {
          period: key.charAt(0).toUpperCase() + key.slice(1),
          current: curr,
          previous: prev,
          growth: `${growth >= 0 ? '+' : ''}${growth}%`
        };
      })
    );

    // ────────────────────────────────────────────────
    //  Monthly order volume for current selected year (line chart)
    // ────────────────────────────────────────────────
    const monthlyOrderVolume = await Order.aggregate([
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

    const orderVolumes = Array(12).fill(0);
    monthlyOrderVolume.forEach(item => {
      orderVolumes[item._id - 1] = item.count;
    });

    // Rough growth vs previous year (optional)
    const prevYearVolume = await Order.countDocuments({
      createdAt: {
        $gte: moment({ year: currentYear - 1 }).startOf('year').toDate(),
        $lte: moment({ year: currentYear - 1 }).endOf('year').toDate()
      }
    });
    const currentYearTotalOrders = orderVolumes.reduce((a, b) => a + b, 0);
    const volumeGrowth = prevYearVolume > 0 
      ? ((currentYearTotalOrders - prevYearVolume) / prevYearVolume * 100).toFixed(1) 
      : 0;

    // ────────────────────────────────────────────────
    //  Best selling products THIS MONTH (by revenue)
    // ────────────────────────────────────────────────
    const monthStart = moment().startOf('month').toDate();
    const monthEnd = moment().endOf('month').toDate();

    const bestSellers = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: monthStart, $lte: monthEnd },
          status: 'delivered'
        }
      },
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
      { $unwind: '$product' },
      {
        $project: {
          name: '$product.name',
          revenue: { $round: ['$revenue'] },
          units: '$units'
        }
      }
    ]);

    // ────────────────────────────────────────────────
    //  Other metrics (your original ones)
    // ────────────────────────────────────────────────
    const [periodOrders, newCustomers, prevNewCustomers, lowStock, recentOrders] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).then(results => {
        const breakdown = { pending: 0, delivered: 0, cancelled: 0 };
        results.forEach(r => {
          if (['pending', 'delivered', 'cancelled'].includes(r._id)) breakdown[r._id] = r.count;
        });
        const total = results.reduce((sum, r) => sum + r.count, 0);
        return { total, breakdown };
      }),

      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: start, $lte: end }
      }),

      User.countDocuments({
        role: 'Customer',
        createdAt: { $gte: prevStart, $lte: prevEnd }
      }),

      Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name')
        .select('sku stockQuantity product')
        .sort({ stockQuantity: 1 })
        .limit(4),

      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select('orderNumber user items total status createdAt')
    ]);

    const customerGrowthPct = prevNewCustomers > 0 
      ? ((newCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1) 
      : newCustomers > 0 ? 100 : 0;

    // ────────────────────────────────────────────────
    //  Final response shape
    // ────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        // Lifetime / overview cards
        totalProducts,
        totalOrders,
        totalCustomers,
        lifetimeRevenue,

        // Period revenue (daily/weekly/monthly)
        revenue: {
          daily: revenueData.find(r => r.period === 'Daily'),
          weekly: revenueData.find(r => r.period === 'Weekly'),
          monthly: revenueData.find(r => r.period === 'Monthly')
        },

        // Sales Trends line chart (monthly order volume)
        salesTrends: {
          year: currentYear,
          months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          volumes: orderVolumes,
          growth: volumeGrowth >= 0 ? `+${volumeGrowth}%` : `${volumeGrowth}%`
        },

        // Best sellers this month
        bestSellers: bestSellers.map((p, i) => ({
          rank: i + 1,
          name: p.name,
          revenue: p.revenue,
          units: p.units,
          label: 'Top performer'
        })),

        // Period-specific
        period: period.charAt(0).toUpperCase() + period.slice(1),
        periodOrders,
        newCustomersThisPeriod: newCustomers,
        customerGrowth: `${customerGrowthPct >= 0 ? '+' : ''}${customerGrowthPct}%`,

        // Low stock & recent orders
        lowStockAlerts: lowStock.map(v => ({
          name: v.product?.name || 'Unknown',
          sku: v.sku || '—',
          unitsLeft: v.stockQuantity
        })),
        recentOrders: recentOrders.map(o => ({
          orderId: o.orderNumber || `#${o._id.toString().slice(-6)}`,
          customer: o.user?.name || 'Guest',
          product: o.items[0]?.product?.name || 'Multiple',
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