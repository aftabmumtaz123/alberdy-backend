const moment = require('moment-timezone');
const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const Category = require('../model/Category');
const mongoose = require('mongoose');

// class ReportController {
//   static getDateRange(period, now) {
//     let start, end, prevStart, prevEnd;

//     if (period === 'daily') {
//       start = now.startOf('day').toDate();
//       end = now.endOf('day').toDate();
//       prevStart = moment(start).subtract(1, 'day').startOf('day').toDate();
//       prevEnd = moment(start).subtract(1, 'day').endOf('day').toDate();
//     } else if (period === 'weekly') {
//       start = now.startOf('week').toDate();
//       end = now.endOf('week').toDate();
//       prevStart = moment(start).subtract(1, 'week').startOf('week').toDate();
//       prevEnd = moment(start).subtract(1, 'week').endOf('week').toDate();
//     } else {
//       start = now.startOf('month').toDate();
//       end = now.endOf('month').toDate();
//       prevStart = moment(start).subtract(1, 'month').startOf('month').toDate();
//       prevEnd = moment(start).subtract(1, 'month').endOf('month').toDate();
//     }
//     return [start, end, prevStart, prevEnd];
//   }

//   static async getSalesByPeriods(req, res) {
//     try {
//       const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

//       const [dailyData, weeklyData, monthlyData] = await Promise.all([
//         ReportController.calculateSalesPeriod('daily', now),
//         ReportController.calculateSalesPeriod('weekly', now),
//         ReportController.calculateSalesPeriod('monthly', now)
//       ]);

//       const data = {
//         daily: dailyData,
//         weekly: weeklyData,
//         monthly: monthlyData
//       };

//       res.json({ success: true, msg: 'Fetched Successfully', data });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }

//   static async calculateSalesPeriod(period, now) {
//     const [start, end, prevStart, prevEnd] = ReportController.getDateRange(period, now);

//     const [currentRevenue, prevRevenue, totalOrders] = await Promise.all([
//       Order.aggregate([
//         { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
//         { $group: { _id: null, total: { $sum: '$total' } } }
//       ]).then(r => r[0]?.total || 0),
//       Order.aggregate([
//         { $match: { createdAt: { $gte: prevStart, $lte: prevEnd }, status: 'delivered' } },
//         { $group: { _id: null, total: { $sum: '$total' } } }
//       ]).then(r => r[0]?.total || 0),
//       Order.countDocuments({ createdAt: { $gte: start, $lte: end } })
//     ]);

//     const averageOrderValue = totalOrders > 0 ? currentRevenue / totalOrders : 0;
//     const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 12.5;
//     const growthRate = revenueGrowth;

//     return {
//       totalRevenue: currentRevenue,
//       revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
//       totalOrders,
//       averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
//       growthRate: `${growthRate > 0 ? '+' : ''}${growthRate}%`,
//       period: period.charAt(0).toUpperCase() + period.slice(1),
//       dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
//     };
//   }

//   static async getMostSoldProducts(req, res) {
//     try {
//       const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

//       const [dailyData, weeklyData, monthlyData] = await Promise.all([
//         ReportController.calculateMostSoldPeriod('daily', now),
//         ReportController.calculateMostSoldPeriod('weekly', now),
//         ReportController.calculateMostSoldPeriod('monthly', now)
//       ]);

//       const data = {
//         daily: dailyData,
//         weekly: weeklyData,
//         monthly: monthlyData
//       };

//       res.json({ success: true, msg: 'Fetched Successfully', data });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }

//   static async calculateMostSoldPeriod(period, now) {
//     const [start, end] = ReportController.getDateRange(period, now.clone());

//     const mostSold = await Order.aggregate([
//       { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
//       { $unwind: '$items' },
//       {
//         $lookup: {
//           from: 'products',
//           localField: 'items.product',
//           foreignField: '_id',
//           as: 'product'
//         }
//       },
//       { $unwind: '$product' },
//       {
//         $lookup: {
//           from: 'variantproducts',
//           localField: 'items.variant',
//           foreignField: '_id',
//           as: 'variant'
//         }
//       },
//       { $unwind: '$variant' },
//       {
//         $lookup: {
//           from: 'offers',
//           let: { prodId: '$product._id', currentDate: now.toDate() },
//           pipeline: [
//             {
//               $match: {
//                 $expr: { $in: ['$$prodId', '$applicableProducts'] },
//                 status: 'active',
//                 $expr: {
//                   $and: [
//                     { $lte: ['$startDate', '$$currentDate'] },
//                     { $gte: ['$endDate', '$$currentDate'] }
//                   ]
//                 }
//               }
//             },
//             { $sort: { createdAt: -1 } },
//             { $limit: 1 },
//             {
//               $project: {
//                 discountType: 1,
//                 discountValue: 1,
//                 _id: 0
//               }
//             }
//           ],
//           as: 'activeOffer'
//         }
//       },
//       { $unwind: { path: '$activeOffer', preserveNullAndEmptyArrays: true } },
//       {
//         $addFields: {
//           effectivePrice: {
//             $cond: {
//               if: { $ne: ['$activeOffer', null] },
//               then: {
//                 $cond: {
//                   if: { $eq: ['$activeOffer.discountType', 'Percentage'] },
//                   then: {
//                     $subtract: [
//                       { $ifNull: ['$variant.price', 0] },
//                       { $multiply: [{ $ifNull: ['$variant.price', 0] }, { $divide: ['$activeOffer.discountValue', 100] }] }
//                     ]
//                   },
//                   else: { $subtract: [{ $ifNull: ['$variant.price', 0] }, '$activeOffer.discountValue'] }
//                 }
//               },
//               else: { $ifNull: ['$variant.price', 0] }
//             }
//           }
//         }
//       },
//       {
//         $group: {
//           _id: '$product._id',
//           productName: { $first: '$product.name' },
//           sku: { $first: '$variant.sku' },
//           totalSold: { $sum: '$items.quantity' },
//           revenue: {
//             $sum: { $multiply: ['$items.quantity', '$effectivePrice'] }
//           }
//         }
//       },
//       { $sort: { totalSold: -1 } },
//       { $limit: 5 }
//     ]);

//     const data = mostSold.map(item => ({
//       productName: item.productName,
//       sku: item.sku,
//       totalSold: item.totalSold,
//       revenue: parseFloat(item.revenue.toFixed(2))
//     }));

//     return {
//       items: data,
//       period: period.charAt(0).toUpperCase() + period.slice(1),
//       dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
//     };
//   }

//   static async getOrdersByStatus(req, res) {
//     try {
//       const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

//       const [start, end] = ReportController.getDateRange('monthly', now);

//       const ordersAgg = await Order.aggregate([
//         { $match: { createdAt: { $gte: start, $lte: end } } },
//         { $group: { _id: '$status', count: { $sum: 1 }, totalRevenue: { $sum: '$total' } } }
//       ]).then(results => {
//         const totalOrders = results.reduce((sum, r) => sum + r.count, 0);
//         const data = results.map(r => ({
//           status: r._id || 'unknown',
//           totalOrders: r.count,
//           percentage: totalOrders > 0 ? ((r.count / totalOrders) * 100).toFixed(2) : 0,
//           revenue: parseFloat(r.totalRevenue.toFixed(2))
//         }));
//         return data;
//       });

//       res.json({ success: true, msg: 'Fetched Successfully', data: ordersAgg });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }

//   static async getLowStockProducts(req, res) {
//     try {
//       const lowStock = await Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
//         .populate('product', 'name')
//         .select('sku stockQuantity image product')
//         .sort({ stockQuantity: 1 })
//         .limit(4);

//       const data = lowStock.map(v => ({
//         name: `${v.product?.name || 'N/A'}`,
//         sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
//         unitsLeft: v.stockQuantity,
//         image: v.image || null
//       }));

//       res.json({ success: true, msg: 'Fetched Successfully', data });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }

//   static async getExpiredProducts(req, res) {
//     try {
//       const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 }).toDate();

//       const expired = await Variant.find({ expiryDate: { $lt: now } })
//         .populate('product', 'name')
//         .select('sku stockQuantity expiryDate product');

//       const data = expired.map(v => ({
//         name: v.product?.name || 'N/A',
//         sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
//         expiryDate: moment.tz(v.expiryDate, 'Asia/Karachi').format('YYYY-MM-DD'),
//         stockQuantity: v.stockQuantity
//       }));

//       res.json({ success: true, msg: 'Fetched Successfully', data });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }

//   static async getRevenueByCategory(req, res) {
//     try {
//       const [start, end] = ReportController.getDateRange('monthly', moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 }));

//       const revenueByCategory = await Order.aggregate([
//         { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
//         { $unwind: '$items' },
//         {
//           $lookup: {
//             from: 'products',
//             localField: 'items.product',
//             foreignField: '_id',
//             as: 'product'
//           }
//         },
//         { $unwind: '$product' },
//         {
//           $lookup: {
//             from: 'categories',
//             localField: 'product.category',
//             foreignField: '_id',
//             as: 'category'
//           }
//         },
//         { $unwind: '$category' },
//         {
//           $group: {
//             _id: '$category._id',
//             category: { $first: '$category.name' },
//             revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
//           }
//         },
//         { $sort: { revenue: -1 } }
//       ]);

//       const data = revenueByCategory.map(item => ({
//         category: item.category,
//         revenue: parseFloat(item.revenue.toFixed(2))
//       }));

//       res.json({ success: true, msg: 'Fetched Successfully', data });
//     } catch (error) {
//       res.status(500).json({ success: false, msg: 'Server error', details: error.message });
//     }
//   }
// }


// module.exports = ReportController; 


class ReportController {
  static getDateRange(period, now) {
    let start, end, prevStart, prevEnd;
    if (period === 'daily') {
      start = now.startOf('day').toDate();
      end = now.endOf('day').toDate();
      prevStart = moment(start).subtract(1, 'day').startOf('day').toDate();
      prevEnd = moment(start).subtract(1, 'day').endOf('day').toDate();
    } else if (period === 'weekly') {
      start = now.startOf('week').toDate();
      end = now.endOf('week').toDate();
      prevStart = moment(start).subtract(1, 'week').startOf('week').toDate();
      prevEnd = moment(start).subtract(1, 'week').endOf('week').toDate();
    } else {
      start = now.startOf('month').toDate();
      end = now.endOf('month').toDate();
      prevStart = moment(start).subtract(1, 'month').startOf('month').toDate();
      prevEnd = moment(start).subtract(1, 'month').endOf('month').toDate();
    }
    return [start, end, prevStart, prevEnd];
  }

  static async getReportsAndAnalytics(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 12, minute: 5, second: 0, millisecond: 0 }); // Current time: 12:05 AM PKT, Nov 11, 2025
      const [salesData, mostSoldData, ordersByStatus, lowStockProducts, expiredProducts, revenueByCategory] = await Promise.all([
        ReportController.getSalesByPeriodsData(now),
        ReportController.getMostSoldProductsData(now),
        ReportController.getOrdersByStatusData(now),
        ReportController.getLowStockProductsData(),
        ReportController.getExpiredProductsData(now),
        ReportController.getRevenueByCategoryData(now)
      ]);

      const data = {
        salesReport: salesData,
        mostSoldProducts: mostSoldData,
        ordersByStatus: ordersByStatus,
        lowStockProducts: lowStockProducts,
        expiredProducts: expiredProducts,
        revenueByCategory: revenueByCategory
      };

      res.json({ success: true, msg: 'Reports & Analytics fetched successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  static async getSalesByPeriodsData(now) {
    const [dailyData, weeklyData, monthlyData] = await Promise.all([
      ReportController.calculateSalesPeriod('daily', now),
      ReportController.calculateSalesPeriod('weekly', now),
      ReportController.calculateSalesPeriod('monthly', now)
    ]);
    return {
      daily: dailyData,
      weekly: weeklyData,
      monthly: monthlyData
    };
  }

  static async calculateSalesPeriod(period, now) {
    const [start, end, prevStart, prevEnd] = ReportController.getDateRange(period, now.clone());
    const [currentRevenue, prevRevenue, totalOrders] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),
      Order.aggregate([
        { $match: { createdAt: { $gte: prevStart, $lte: prevEnd }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),
      Order.countDocuments({ createdAt: { $gte: start, $lte: end }, status: 'delivered' })
    ]);
    const averageOrderValue = totalOrders > 0 ? currentRevenue / totalOrders : 0;
    const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : 12.5;
    const growthRate = revenueGrowth;
    return {
      totalRevenue: parseFloat(currentRevenue.toFixed(2)),
      revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
      totalOrders,
      averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
      growthRate: `${growthRate > 0 ? '+' : ''}${growthRate}%`,
      period: period.charAt(0).toUpperCase() + period.slice(1),
      dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
    };
  }

  static async getMostSoldProductsData(now) {
    const [dailyData, weeklyData, monthlyData] = await Promise.all([
      ReportController.calculateMostSoldPeriod('daily', now),
      ReportController.calculateMostSoldPeriod('weekly', now),
      ReportController.calculateMostSoldPeriod('monthly', now)
    ]);
    return {
      daily: dailyData,
      weekly: weeklyData,
      monthly: monthlyData
    };
  }

  static async calculateMostSoldPeriod(period, now) {
const [start, end] = ReportController.getDateRange(period, now.clone());

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

  static async getOrdersByStatusData(now) {
    const [start, end] = ReportController.getDateRange('monthly', now);
    const ordersAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$status', count: { $sum: 1 }, totalRevenue: { $sum: '$total' } } }
    ]).then(results => {
      const totalOrders = results.reduce((sum, r) => sum + r.count, 0);
      const data = results.map(r => ({
        status: r._id || 'unknown',
        totalOrders: r.count,
        percentage: totalOrders > 0 ? ((r.count / totalOrders) * 100).toFixed(2) : 0,
        revenue: parseFloat(r.totalRevenue.toFixed(2))
      }));
      return data;
    });
    return ordersAgg;
  }

  static async getLowStockProductsData() {
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
    return data;
  }

  static async getExpiredProductsData(now) {
    const expired = await Variant.find({ expiryDate: { $lt: now } })
      .populate('product', 'name')
      .select('sku stockQuantity expiryDate product');
    const data = expired.map(v => ({
      name: v.product?.name || 'N/A',
      sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
      expiryDate: moment.tz(v.expiryDate, 'Asia/Karachi').format('YYYY-MM-DD'),
      stockQuantity: v.stockQuantity
    }));
    return data;
  }

  static async getRevenueByCategoryData(now) {
    const [start, end] = ReportController.getDateRange('monthly', now);
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
    return data;
  }
}

module.exports = ReportController;
