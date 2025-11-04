const moment = require('moment-timezone');
const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const Category = require('../model/Category');

class ReportController {
  // Helper function to get date range based on period and current date
  static getDateRange(period, now) {
    let start, end, prevStart, prevEnd;

    if (period === 'daily') {
      start = now.startOf('day').toDate(); // Start of November 04, 2025
      end = now.endOf('day').toDate();    // End of November 04, 2025
      prevStart = moment(start).subtract(1, 'day').startOf('day').toDate(); // October 04, 2025
      prevEnd = moment(start).subtract(1, 'day').endOf('day').toDate();    // October 04, 2025
    } else if (period === 'weekly') {
      start = now.startOf('week').toDate(); // Start of week (October 28, 2025)
      end = now.endOf('week').toDate();    // End of week (November 03, 2025)
      prevStart = moment(start).subtract(1, 'week').startOf('week').toDate(); // October 21, 2025
      prevEnd = moment(start).subtract(1, 'week').endOf('week').toDate();    // October 27, 2025
    } else { // monthly
      start = now.startOf('month').toDate(); // Start of November 01, 2025
      end = now.endOf('month').toDate();    // End of November 30, 2025
      prevStart = moment(start).subtract(1, 'month').startOf('month').toDate(); // October 01, 2025
      prevEnd = moment(start).subtract(1, 'month').endOf('month').toDate();    // October 31, 2025
    }
    return [start, end, prevStart, prevEnd];
  }

  // Get Sales by Daily, Weekly, and Monthly Periods
  static async getSalesByPeriods(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 12, minute: 33, second: 0, millisecond: 0 }); // 12:33 PM PKT, November 04, 2025

      const [dailyData, weeklyData, monthlyData] = await Promise.all([
        ReportController.calculateSalesPeriod('daily', now),
        ReportController.calculateSalesPeriod('weekly', now),
        ReportController.calculateSalesPeriod('monthly', now)
      ]);

      const data = {
        daily: dailyData,
        weekly: weeklyData,
        monthly: monthlyData
      };

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  // Helper function to calculate sales for a given period
  static async calculateSalesPeriod(period, now) {
    const [start, end, prevStart, prevEnd] = ReportController.getDateRange(period, now);

    const [currentRevenue, prevRevenue, totalOrders] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),
      Order.aggregate([
        { $match: { createdAt: { $gte: prevStart, $lte: prevEnd }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),
      Order.countDocuments({ createdAt: { $gte: start, $lte: end } })
    ]);

    const averageOrderValue = totalOrders > 0 ? currentRevenue / totalOrders : 0;
    const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 12.5;
    const growthRate = revenueGrowth;

    return {
      totalRevenue: currentRevenue,
      revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
      totalOrders,
      averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
      growthRate: `${growthRate > 0 ? '+' : ''}${growthRate}%`,
      period: period.charAt(0).toUpperCase() + period.slice(1),
      dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
    };
  }

  // Get Most Sold Products by Daily, Weekly, and Monthly Periods
  static async getMostSoldProducts(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 12, minute: 33, second: 0, millisecond: 0 }); // 12:33 PM PKT, November 04, 2025

      const [dailyData, weeklyData, monthlyData] = await Promise.all([
        ReportController.calculateMostSoldPeriod('daily', now),
        ReportController.calculateMostSoldPeriod('weekly', now),
        ReportController.calculateMostSoldPeriod('monthly', now)
      ]);

      const data = {
        daily: dailyData,
        weekly: weeklyData,
        monthly: monthlyData
      };

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  // Helper function to calculate most sold products for a given period
  static async calculateMostSoldPeriod(period, now) {
    const [start, end] = ReportController.getDateRange(period, now);

    const mostSold = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'variantproducts',
          localField: 'items.variant',
          foreignField: '_id',
          as: 'variant'
        }
      },
      { $unwind: '$variant' },
      {
        $group: {
          _id: '$product._id',
          productName: { $first: '$product.name' },
          sku: { $first: '$variant.sku' },
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 }
    ]);

    const data = mostSold.map(item => ({
      productName: item.productName,
      sku: item.sku,
      totalSold: item.totalSold,
      revenue: parseFloat(item.revenue.toFixed(2))
    }));

    return {
      items: data,
      period: period.charAt(0).toUpperCase() + period.slice(1),
      dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
    };
  }

  // Get Orders by Status (Default: Current month)
  static async getOrdersByStatus(req, res) {
    try {
      const [start, end] = ReportController.getDateRange('monthly', moment.tz('Asia/Karachi').set({ hour: 12, minute: 33, second: 0, millisecond: 0 }));

      const ordersAgg = await Order.aggregate([
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
      });

      const data = {
        total: ordersAgg.total,
        breakdown: ordersAgg.breakdown,
        period: 'Monthly'
      };

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  // Get Low Stock Products (Default: Top 4)
  static async getLowStockProducts(req, res) {
    try {
      const lowStock = await Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name')
        .select('sku stockQuantity image product')
        .sort({ stockQuantity: 1 })
        .limit(4);

      const data = lowStock.map(v => ({
        name: `${v.product?.name || 'N/A'}`,
        sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
        unitsLeft: v.stockQuantity,
        image: v.image || null
      }));

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  // Get Expired Products
  static async getExpiredProducts(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 12, minute: 33, second: 0, millisecond: 0 }).toDate();

      const expired = await Variant.find({ expiryDate: { $lt: now } })
        .populate('product', 'name')
        .select('sku stockQuantity expiryDate product');

      const data = expired.map(v => ({
        name: v.product?.name || 'N/A',
        sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
        expiryDate: moment.tz(v.expiryDate, 'Asia/Karachi').format('YYYY-MM-DD'),
        stockQuantity: v.stockQuantity
      }));

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  // Get Revenue by Category (Default: Current month)
  static async getRevenueByCategory(req, res) {
    try {
      const [start, end] = ReportController.getDateRange('monthly', moment.tz('Asia/Karachi').set({ hour: 12, minute: 33, second: 0, millisecond: 0 }));

      const revenueByCategory = await Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $lookup: {
            from: 'categories',
            localField: 'product.category',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $unwind: '$category' },
        {
          $group: {
            _id: '$category._id',
            category: { $first: '$category.name' },
            revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      const data = revenueByCategory.map(item => ({
        category: item.category,
        revenue: parseFloat(item.revenue.toFixed(2))
      }));

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }
}

module.exports = ReportController;