import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { 
  ShoppingBag, 
  TrendingUp, 
  Users, 
  DollarSign,
  Package,
  AlertCircle,
  ExternalLink,
  RefreshCw
} from 'lucide-react';

export default function ShopifyDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Simulate loading shopify data
    setTimeout(() => {
      setData({
        totalSales: 15420,
        orders: 127,
        customers: 845,
        products: 32,
        topProducts: [
          { name: 'Premium Package Design', sales: 45, revenue: 6750 },
          { name: 'Brand Identity Kit', sales: 32, revenue: 4800 },
          { name: 'Website Design', sales: 28, revenue: 8400 },
        ],
        recentOrders: [
          { id: '#1234', customer: 'John Doe', amount: 150, status: 'completed' },
          { id: '#1235', customer: 'Jane Smith', amount: 300, status: 'processing' },
          { id: '#1236', customer: 'Bob Johnson', amount: 75, status: 'pending' },
        ]
      });
      setLoading(false);
    }, 1000);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Shopify Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor your e-commerce performance and customer data
          </p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh Data
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-xl font-semibold">${data?.totalSales?.toLocaleString() || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <ShoppingBag className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Orders</p>
              <p className="text-xl font-semibold">{data?.orders || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Customers</p>
              <p className="text-xl font-semibold">{data?.customers || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Package className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Products</p>
              <p className="text-xl font-semibold">{data?.products || 0}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Top Products</h2>
          </div>
          <div className="p-4">
            {data?.topProducts?.map((product, index) => (
              <div key={index} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div>
                  <p className="font-medium text-foreground">{product.name}</p>
                  <p className="text-sm text-muted-foreground">{product.sales} sales</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">${product.revenue}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Orders */}
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground">Recent Orders</h2>
          </div>
          <div className="p-4">
            {data?.recentOrders?.map((order, index) => (
              <div key={index} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div>
                  <p className="font-medium text-foreground">{order.id}</p>
                  <p className="text-sm text-muted-foreground">{order.customer}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">${order.amount}</p>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    order.status === 'completed' ? 'bg-green-100 text-green-700' :
                    order.status === 'processing' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Integration Notice */}
      <Card className="p-4 border-l-4 border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">Shopify Integration Required</h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Connect your Shopify store to view real-time data. This is currently showing demo data.
            </p>
            <button className="flex items-center gap-1 mt-2 text-sm text-yellow-800 dark:text-yellow-200 hover:underline">
              <ExternalLink className="w-4 h-4" />
              Set up integration
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}