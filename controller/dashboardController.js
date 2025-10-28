// GET /api/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const { period = 'monthly', limit = 5 } = req.query;
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period: daily, weekly, or monthly' });
    }

    const now = moment();

    // ---------- 1. DATE RANGES ----------
    let startDate, endDate, prevStartDate, prevEndDate;
    if (period === 'daily') {
      startDate = now.startOf('day').toDate();
      endDate   = now.endOf('day').toDate();
      const prev = moment(startDate).subtract(1, 'day');
      prevStartDate = prev.startOf('day').toDate();
      prevEndDate   = prev.endOf('day').toDate();
    } else if (period === 'weekly') {
      startDate = now.startOf('week').toDate();
      endDate   = now.endOf('week').toDate();
      const prev = moment(startDate).subtract(1, 'week');
      prevStartDate = prev.startOf('week').toDate();
      prevEndDate   = prev.endOf('week').toDate();
    } else {
      startDate = now.startOf('month').toDate();
      endDate   = now.endOf('month').toDate();
      const prev = moment(startDate).subtract(1, 'month');
      prevStartDate = prev.startOf('month').toDate();
      prevEndDate   = prev.endOf('month').toDate();
    }

    // ---------- 2. ALL-TIME TOTALS ----------
    const [totalProductsAll, totalOrdersAll, totalCustomersAll] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'Customer' })
    ]);

    // ---------- 3. PERIOD-SPECIFIC AGGREGATIONS ----------
    const [
      periodOrdersAgg,
      periodNewCustomers,
      lowStockResult,          // <-- NEW
      recentOrders,
      currentRevenue,
      prevRevenue,
      prevNewCustomers
    ] = await Promise.all([
      // … (order breakdown) – unchanged …
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).then(results => {
        const breakdown = { pending: 0, delivered: 0, cancelled: 0 };
        let total = 0;
        results.forEach(r => {
          if (['pending', 'delivered', 'cancelled'].includes(r._id)) {
            breakdown[r._id] = r.count;
          }
          total += r.count;
        });
        return { total, breakdown };
      }),

      User.countDocuments({ role: 'Customer', createdAt: { $gte: startDate, $lte: endDate } }),

      // ---------- LOW-STOCK PIPELINE ----------
      Product.aggregate([
        // 1. Pull variants into the product document
        {
          $lookup: {
            from: 'variants',
            let: { varIds: { $ifNull: ['$variations', []] } },
            pipeline: [{ $match: { $expr: { $in: ['$_id', '$$varIds'] } } } }},
            as: 'variants'
          }
        },
        // 2. Compute total stock
        {
          $addFields: {
            totalStock: { $sum: '$variants.stockQuantity' }
          }
        },
        // 3. Filter low-stock
        { $match: { totalStock: { $lt: 10, $gt: -1 } } },
        // 4. Sort & limit for the UI card
        { $sort: { totalStock: 1 } },
        // 5. Parallel count (we need the total count separately)
        { $facet: {
            alerts: [
              { $limit: 4 },
              {
                $project: {
                  name: 1,
                  sku: { $ifNull: ['$sku', { $concat: ['SKU-', { $substr: ['$_id', -4, -1] }] }] },
                  unitsLeft: '$totalStock',
                  thumbnail: { $arrayElemAt: ['$images', 0] }   // first image as thumbnail
                }
              }
            ],
            count: [{ $count: 'total' }]
          }
        }
      ]),

      Order.find()
        .populate('user', 'name')
        .populate('items.product', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select('orderNumber user items total status createdAt'),

      Order.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),

      Order.aggregate([
        { $match: { createdAt: { $gte: prevStartDate, $lte: prevEndDate }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).then(r => r[0]?.total || 0),

      User.countDocuments({ role: 'Customer', createdAt: { $gte: prevStartDate, $lte: prevEndDate } })
    ]);

    // ---------- 4. FORMAT LOW-STOCK ----------
    const lowStockCount   = lowStockResult[0]?.count[0]?.total ?? 0;
    const lowStockAlerts  = lowStockResult[0]?.alerts ?? [];

    // ---------- 5. RECENT ORDERS ----------
    const formattedRecentOrders = recentOrders.map(o => ({
      orderId: o.orderNumber?.startsWith('#ORD-')
        ? o.orderNumber
        : `#ORD-${String(o._id).slice(-3).padStart(3, '0')}`,
      customer: o.user?.name || 'Unknown',
      product: o.items[0]?.product?.name || 'N/A',
      amount: o.total,
      status: o.status.charAt(0).toUpperCase() + o.status.slice(1),
      date: moment(o.createdAt).format('YYYY-MM-DD')
    }));

    // ---------- 6. GROWTH ----------
    const revenueGrowth = prevRevenue > 0
      ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1)
      : 12.5;
    const customerGrowth = prevNewCustomers > 0
      ? ((periodNewCustomers - prevNewCustomers) / prevNewCustomers * 100).toFixed(1)
      : 12;

    // ---------- 7. RESPONSE ----------
    res.json({
      success: true,
      data: {
        totalProducts: totalProductsAll,
        productGrowth: '+8%',                     // placeholder – implement if you have historic data
        totalOrders: totalOrdersAll,
        orderBreakdown: periodOrdersAgg.breakdown,
        orderGrowth: '+15%',                      // placeholder
        totalCustomers: totalCustomersAll,
        customerGrowth: `${customerGrowth > 0 ? '+' : ''}${customerGrowth}%`,
        revenue: currentRevenue,
        revenueGrowth: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth}%`,
        revenuePeriod: period.charAt(0).toUpperCase() + period.slice(1),

        // <<< LOW-STOCK SECTION >>>
        lowStockCount,
        lowStockAlerts,        // array of { name, sku, unitsLeft, thumbnail }

        recentOrders: formattedRecentOrders
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
};

