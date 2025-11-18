const moment = require('moment-timezone');
const Order = require('../model/Order');
const Product = require('../model/Product');
const Variant = require('../model/variantProduct');
const Expense = require('../model/Expense')
const Category = require('../model/Category');
const mongoose = require('mongoose');

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

  static async getSalesByPeriods(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

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

  static async getMostSoldProducts(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

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

static async calculateMostSoldPeriod(period, now) {
  const [start, end] = ReportController.getDateRange(period, now.clone());

  const mostSold = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, status: 'delivered' } },
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          product: '$items.product',
          variant: '$items.variant'
        },
        totalSold: { $sum: '$items.quantity' },
        totalOrders: { $addToSet: '$_id' } // count unique orders
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: '_id.product',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: '$product' },
    {
      $lookup: {
        from: 'variantproducts',
        localField: '_id.variant',
        foreignField: '_id',
        as: 'variant'
      }
    },
    { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        productName: '$product.name',
        category: { $ifNull: ['$category.name', 'Uncategorized'] },
        image: { $ifNull: ['$product.thumbnail', '$product.images.0'] },
        sku: '$variant.sku',
        totalSold: 1,
        totalOrders: { $size: '$totalOrders' },
        revenue: { $multiply: ['$totalSold', { $ifNull: ['$variant.price', 0] }] } // adjust with offers if needed
      }
    },
    { $sort: { totalSold: -1 } },
    { $limit: 5 }
  ]);

  const data = mostSold.map(item => ({
    productName: item.productName,
    category: item.category,
    image: item.image || null,
    totalSold: item.totalSold,
    totalOrders: item.totalOrders,
    revenue: parseFloat(item.revenue.toFixed(2))
  }));

  return {
    items: data,
    period: period.charAt(0).toUpperCase() + period.slice(1),
    dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`
  };
}

  static async getOrdersByStatus(req, res) {
    try {
      const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });

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

      res.json({ success: true, msg: 'Fetched Successfully', data: ordersAgg });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }

  static async getLowStockProducts(req, res) {
    try {
      const lowStock = await Variant.find({ stockQuantity: { $lt: 10, $gt: -1 } })
        .populate('product', 'name thumbnail')
        .select('sku stockQuantity image product')
        .sort({ stockQuantity: 1 })
        .limit(4);

      const data = lowStock.map(v => ({
        name: `${v.product?.name || 'N/A'}`,
        sku: v.sku || `SKU-${String(v._id).slice(-4)}`,
        unitsLeft: v.stockQuantity,
        image: v.product?.thumbnail || null,
      }));

      res.json({ success: true, msg: 'Fetched Successfully', data });
    } catch (error) {
      res.status(500).json({ success: false, msg: 'Server error', details: error.message });
    }
  }
static async getExpiredProducts(req, res) {
  try {
    const now = moment.tz('Asia/Karachi');
    const today = now.clone().startOf('day');

    const variants = await Variant.find({
      expiryDate: { $exists: true, $ne: null },
      $or: [
        { expiryDate: { $lt: today.toDate() } },
        { expiryDate: { $gte: today.toDate(), $lte: moment(today).add(30, 'days').toDate() } }
      ]
    })
      .populate({
        path: 'product',
        select: 'name thumbnail',           
        populate: {
          path: 'category',
          select: 'name image'
        }
      })
      .select('sku expiryDate product stockQuantity')
      .sort({ expiryDate: 1 })
      .limit(10);

    const data = variants.map(v => {
      const expiry = moment.tz(v.expiryDate, 'Asia/Karachi').startOf('day');
      const diffDays = expiry.diff(today, 'days');

      let status, statusType;
      if (diffDays < 0) {
        status = `Expired ${Math.abs(diffDays)} days ago`;
        statusType = "expired";
      } else if (diffDays === 0) {
        status = "Expires today";
        statusType = "expired";
      } else {
        status = `Expires in ${diffDays} days`;
        statusType = "expiring";
      }

      return {
        productName: v.product?.name || 'Unknown Product',
        category: v.product?.category?.name || 'Uncategorized',
        image: v.product?.thumbnail || null,   
        expiryDate: expiry.format('YYYY-MM-DD'),
        status,
        statusType,
        days: Math.abs(diffDays)
      };
    });

    res.json({ success: true, msg: "Fetched Successfully", data });

  } catch (error) {
    console.error('Expired Products Error:', error);
    res.status(500).json({ success: false, msg: 'Server error', details: error.message });
  }
}


 static async getRevenueByCategory(req, res) {
  try {
    const now = moment.tz('Asia/Karachi').set({ hour: 13, minute: 0, second: 0, millisecond: 0 });
    const [start, end, prevStart, prevEnd] = ReportController.getDateRange('monthly', now);

    const pipeline = [
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
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$product.category',
          categoryName: { $first: { $ifNull: ['$category.name', 'Uncategorized'] } },
          image: { $first: { $ifNull: ['$category.image', null] } },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          orders: { $addToSet: '$_id' } // unique orders
        }
      },
      {
        $addFields: {
          totalOrders: { $size: '$orders' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ];

    const currentPeriod = await Order.aggregate(pipeline);

    // Previous period for growth calculation
    const prevPipeline = pipeline.map(stage => {
      if (stage.$match) {
        return { $match: { ...stage.$match, createdAt: { $gte: prevStart, $lte: prevEnd } } };
      }
      return stage;
    });

    const previousPeriod = await Order.aggregate(prevPipeline);

    const prevMap = new Map(previousPeriod.map(p => [p._id?.toString(), p.totalRevenue || 0]));

    const totalCurrentRevenue = currentPeriod.reduce((sum, c) => sum + c.totalRevenue, 0);

    const data = currentPeriod.map(cat => {
      const prevRevenue = prevMap.get(cat._id?.toString()) || 0;
      const growth = prevRevenue > 0 
        ? ((cat.totalRevenue - prevRevenue) / prevRevenue) * 100 
        : cat.totalRevenue > 0 ? 100 : 0;

      const percentageOfTotal = totalCurrentRevenue > 0 
        ? (cat.totalRevenue / totalCurrentRevenue) * 100 
        : 0;

      return {
        category: cat.categoryName,
        image: cat.image || null,
        totalOrders: cat.totalOrders,
        revenue: parseFloat(cat.totalRevenue.toFixed(2)),
        percentageOfTotal: `${percentageOfTotal.toFixed(1)}%`,
        growth: `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`
      };
    });

    res.json({
      success: true,
      msg: "Fetched Successfully",
      data,
      summary: {
        totalRevenue: parseFloat(totalCurrentRevenue.toFixed(2)),
        dateRange: `${moment.tz(start, 'Asia/Karachi').format('MMM DD, YYYY')} - ${moment.tz(end, 'Asia/Karachi').format('MMM DD, YYYY')}`,
        period: "Monthly"
      }
    });

  } catch (error) {
    console.error('Revenue by Category Error:', error);
    res.status(500).json({ success: false, msg: 'Server error', details: error.message });
  }
}


static async getTopCustomersPnL(req, res) {
  try {
    const now = moment.tz('Asia/Karachi');
    const [start] = ReportController.getDateRange('monthly', now);

    const topCustomers = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start },
          status: 'delivered',
          paymentStatus: 'paid'
        }
      },
      { $unwind: '$items' },

      // Get cost price from Variant
      {
        $lookup: {
          from: 'variants',
          localField: 'items.variant',
          foreignField: '_id',
          as: 'variantData'
        }
      },
      { $unwind: { path: '$variantData', preserveNullAndEmptyArrays: true } },

      // GROUP BY CUSTOMER
      {
        $group: {
          _id: '$user',
          totalRevenue: { $sum: '$items.total' },
          totalCost: {
            $sum: {
              $multiply: ['$items.quantity', { $ifNull: ['$variantData.purchasePrice', 0] }]
            }
          },
          orderIds: { $addToSet: '$_id' },
          customerNameFromOrder: { $first: '$shippingAddress.fullName' },
          customerCity: { $first: '$shippingAddress.city' }   // ← THIS WAS MISSING!
        }
      },

      // Calculate profit & margin
      {
        $addFields: {
          totalProfit: { $subtract: ['$totalRevenue', '$totalCost'] },
          orderCount: { $size: '$orderIds' },
          margin: {
            $cond: [
              { $gt: ['$totalRevenue', 0] },
              { $round: [{ $multiply: [{ $divide: [{ $subtract: ['$totalRevenue', '$totalCost'] }, '$totalRevenue'] }, 100] }, 1] },
              0
            ]
          }
        }
      },

      // Get user profile data
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

      // FINAL OUTPUT
      {
        $project: {
          customer: {
            $ifNull: ['$user.name', '$customerNameFromOrder', 'Walk-in Customer']
          },
          region: {
            $ifNull: [
              '$user.address.city',     // From user profile (if set)
              '$customerCity',          // ← Now exists! From order shipping address
              'N/A'
            ]
          },
          revenue: { $round: ['$totalRevenue', 2] },
          cost: { $round: ['$totalCost', 2] },
          profit: { $round: ['$totalProfit', 2] },
          margin: '$margin',
          orders: '$orderCount'
        }
      },

      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    const formatted = topCustomers.map(c => ({
      customer: c.customer,
      region: c.region,
      revenue: `${c.revenue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      cost: `${c.cost.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      profit: `${c.profit.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      margin: `${c.margin}%`,
      orders: c.orders
    }));

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error('getTopCustomersPnL Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}



static async getTopProductsPnL(req, res) {
  try {
    const now = moment.tz('Asia/Karachi');
    const [start] = ReportController.getDateRange('monthly', now);

    const topProducts = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start },
          status: 'delivered',
          paymentStatus: 'paid'
        }
      },
      { $unwind: '$items' },

      {
        $lookup: {
          from: 'variants',
          localField: 'items.variant',
          foreignField: '_id',
          as: 'variant'
        }
      },
      { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },

      {
        $group: {
          _id: '$items.product',
          unitsSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' },
          cost: {
            $sum: {
              $multiply: ['$items.quantity', { $ifNull: ['$variant.purchasePrice', 0] }]
            }
          }
        }
      },

      {
        $addFields: {
          profit: { $subtract: ['$revenue', '$cost'] },
          margin: {
            $cond: [
              { $gt: ['$revenue', 0] },
              { $round: [{ $multiply: [{ $divide: [{ $subtract: ['$revenue', '$cost'] }, '$revenue'] }, 100] }, 1] },
              0
            ]
          }
        }
      },

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
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },

      {
        $project: {
          product: '$product.name',
          category: { $ifNull: ['$category.name', 'Uncategorized'] },
          units: '$unitsSold',
          revenue: { $round: ['$revenue', 2] },
          cost: { $round: ['$cost', 2] },
          profit: { $round: ['$profit', 2] },
          margin: '$margin'
        }
      },

      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    const formatted = topProducts.map(p => ({
      product: p.product,
      category: p.category,
      units: p.units,
      revenue: `${p.revenue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      cost: `${p.cost.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      profit: `${p.profit.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`,
      margin: `${p.margin}%`
    }));

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error('getTopProductsPnL Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

  static async getProfitLossReport(req, res) {
    try {
      const [salesResult, expensesResult] = await Promise.all([
        Order.aggregate([
          { $match: { status: { $in: ['delivered', 'Delivered'] } } }, // Fixed case
          { $unwind: '$items' },
          {
            $lookup: {
              from: 'variantproducts',
              localField: 'items.variant',
              foreignField: '_id',
              as: 'variant'
            }
          },
          { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: null,
              totalSales: { $sum: '$total' },
              totalDiscounts: { $sum: { $ifNull: ['$discount', 0] } },
              totalRefunds: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, '$total', 0] } },
              totalCOGS: {
                $sum: {
                  $multiply: [
                    '$items.quantity',
                    {
                      $ifNull: [
                        '$variant.purchasePrice',
                        { $ifNull: ['$variant.costPrice', { $ifNull: ['$variant.cost', 0] }] }
                      ]
                    }
                  ]
                }
              },
              orderCount: { $sum: 1 }
            }
          }
        ]),
        Expense.aggregate([
          { $group: { _id: '$category', amount: { $sum: '$amount' } } }
        ])
      ]);

      const sales = salesResult[0] || { totalSales: 0, totalDiscounts: 0, totalRefunds: 0, totalCOGS: 0, orderCount: 0 };
      const expenses = expensesResult || [];

      const netRevenue = sales.totalSales - sales.totalDiscounts - sales.totalRefunds;
      const grossProfit = netRevenue - sales.totalCOGS;
      const totalOperatingExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      const netProfit = grossProfit - totalOperatingExpenses;

      const grossMargin = sales.totalSales > 0 ? (grossProfit / sales.totalSales) * 100 : 0;
      const netMargin = sales.totalSales > 0 ? (netProfit / sales.totalSales) * 100 : 0;

      const expenseBreakdown = {
        rent: expenses.find(e => ['Rent', 'rent'].includes(e._id))?.amount || 0,
        salaries: expenses.find(e => ['Salaries', 'salaries'].includes(e._id))?.amount || 0,
        marketing: expenses.find(e => ['Marketing', 'marketing'].includes(e._id))?.amount || 0,
        utilities: expenses.find(e => ['Utilities', 'utilities'].includes(e._id))?.amount || 0,
        insurance: expenses.find(e => ['Insurance', 'insurance'].includes(e._id))?.amount || 0,
        other: expenses.filter(e => !['Rent','rent','Salaries','salaries','Marketing','marketing','Utilities','utilities','Insurance','insurance'].includes(e._id))
                       .reduce((s, e) => s + e.amount, 0)
      };

      res.json({
        success: true,
        period: { label: "All Time (Lifetime)", startDate: null, endDate: null },
        cards: {
          totalSales: Number(sales.totalSales.toFixed(2)),
          netRevenue: Number(netRevenue.toFixed(2)),
          grossProfit: Number(grossProfit.toFixed(2)),
          netProfit: Number(netProfit.toFixed(2)),
          grossProfitMargin: Number(grossMargin.toFixed(2)),
          netProfitMargin: Number(netMargin.toFixed(2))
        },
        incomeStatement: {
          revenue: Number(sales.totalSales.toFixed(2)),
          lessDiscounts: Number(sales.totalDiscounts.toFixed(2)),
          lessRefunds: Number(sales.totalRefunds.toFixed(2)),
          netRevenue: Number(netRevenue.toFixed(2)),
          cogs: Number(sales.totalCOGS.toFixed(2)),
          grossProfit: Number(grossProfit.toFixed(2)),
          grossProfitMargin: `${grossMargin.toFixed(2)}%`,
          operatingExpenses: {
            rent: Number(expenseBreakdown.rent.toFixed(2)),
            salaries: Number(expenseBreakdown.salaries.toFixed(2)),
            marketing: Number(expenseBreakdown.marketing.toFixed(2)),
            utilities: Number(expenseBreakdown.utilities.toFixed(2)),
            insurance: Number(expenseBreakdown.insurance.toFixed(2)),
            other: Number(expenseBreakdown.other.toFixed(2)),
            total: Number(totalOperatingExpenses.toFixed(2))
          },
          netProfit: Number(netProfit.toFixed(2)),
          netProfitMargin: `${netMargin.toFixed(2)}%`
        },
        ratios: {
          costOfGoodsSold: Number(sales.totalCOGS.toFixed(2)),
          cogsPercentage: netRevenue > 0 ? `${((sales.totalCOGS / netRevenue) * 100).toFixed(2)}%` : '0%',
          operatingExpenses: Number(totalOperatingExpenses.toFixed(2)),
          operatingExpenseRatio: netRevenue > 0 ? `${((totalOperatingExpenses / netRevenue) * 100).toFixed(2)}%` : '0%',
          profitabilityRatio: `${netMargin.toFixed(2)}%`
        },
        summary: {
          totalOrders: sales.orderCount,
          averageOrderValue: sales.orderCount > 0 ? Number((sales.totalSales / sales.orderCount).toFixed(2)) : 0
        }
      });
    } catch (error) {
      console.error('Profit & Loss Error:', error);
      res.status(500).json({ success: false, msg: 'Server error', error: error.message });
    }
  }


}


module.exports = ReportController; 
