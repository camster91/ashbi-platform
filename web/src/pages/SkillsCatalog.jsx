import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui';
import { 
  Puzzle, 
  Download, 
  Star, 
  Search,
  Filter,
  Plus,
  ExternalLink,
  Code,
  Globe,
  MessageSquare,
  Zap,
  Shield,
  Briefcase
} from 'lucide-react';

export default function SkillsCatalog() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [data, setData] = useState(null);

  useEffect(() => {
    // Simulate loading skills data
    setTimeout(() => {
      setData({
        totalSkills: 48,
        installedSkills: 12,
        categories: ['all', 'communication', 'marketing', 'development', 'automation', 'analytics'],
        skills: [
          {
            id: 1,
            name: 'Email Triage',
            category: 'communication',
            description: 'Automatically categorize and prioritize incoming emails',
            version: '2.1.0',
            author: 'Ashbi Design',
            rating: 4.8,
            downloads: 1250,
            installed: true,
            featured: true,
            icon: '📧',
            tags: ['email', 'automation', 'productivity']
          },
          {
            id: 2,
            name: 'SEO Content Generator',
            category: 'marketing',
            description: 'Generate SEO-optimized blog posts and web content',
            version: '1.5.2',
            author: 'Marketing Tools',
            rating: 4.6,
            downloads: 890,
            installed: false,
            featured: true,
            icon: '📝',
            tags: ['seo', 'content', 'marketing']
          },
          {
            id: 3,
            name: 'WordPress Security Scanner',
            category: 'development',
            description: 'Automated security auditing for WordPress sites',
            version: '3.0.1',
            author: 'Security Pro',
            rating: 4.9,
            downloads: 2100,
            installed: true,
            featured: false,
            icon: '🔒',
            tags: ['wordpress', 'security', 'audit']
          },
          {
            id: 4,
            name: 'Social Media Scheduler',
            category: 'marketing',
            description: 'Schedule and automate social media posts across platforms',
            version: '2.3.0',
            author: 'Social Tools',
            rating: 4.4,
            downloads: 1560,
            installed: false,
            featured: true,
            icon: '📱',
            tags: ['social media', 'scheduling', 'automation']
          },
          {
            id: 5,
            name: 'Client Analytics Dashboard',
            category: 'analytics',
            description: 'Comprehensive analytics and reporting for client projects',
            version: '1.8.3',
            author: 'Analytics Suite',
            rating: 4.7,
            downloads: 670,
            installed: true,
            featured: false,
            icon: '📊',
            tags: ['analytics', 'reporting', 'dashboard']
          },
          {
            id: 6,
            name: 'Invoice Generator Pro',
            category: 'automation',
            description: 'Automated invoice generation and payment tracking',
            version: '2.0.0',
            author: 'Business Tools',
            rating: 4.5,
            downloads: 920,
            installed: false,
            featured: false,
            icon: '💼',
            tags: ['invoicing', 'payments', 'automation']
          }
        ]
      });
      setLoading(false);
    }, 1000);
  }, []);

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'communication': return <MessageSquare className="w-4 h-4" />;
      case 'marketing': return <Globe className="w-4 h-4" />;
      case 'development': return <Code className="w-4 h-4" />;
      case 'automation': return <Zap className="w-4 h-4" />;
      case 'analytics': return <Briefcase className="w-4 h-4" />;
      default: return <Puzzle className="w-4 h-4" />;
    }
  };

  const filteredSkills = data?.skills?.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         skill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         skill.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />
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
          <h1 className="text-2xl font-heading font-bold text-foreground">Skills Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discover and install new AI skills to enhance your workflow
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            Create Skill
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Puzzle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Skills</p>
              <p className="text-xl font-semibold">{data?.totalSkills || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <Download className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Installed</p>
              <p className="text-xl font-semibold">{data?.installedSkills || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
              <Star className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Featured</p>
              <p className="text-xl font-semibold">{data?.skills?.filter(s => s.featured).length || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Shield className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Categories</p>
              <p className="text-xl font-semibold">{data?.categories?.length - 1 || 0}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {data?.categories?.map(category => (
              <option key={category} value={category}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSkills.map((skill) => (
          <Card key={skill.id} className="p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="text-2xl">{skill.icon}</div>
                <div>
                  <h3 className="font-semibold text-foreground">{skill.name}</h3>
                  <p className="text-sm text-muted-foreground">v{skill.version} • by {skill.author}</p>
                </div>
              </div>
              {skill.featured && (
                <div className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-full">
                  Featured
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground mb-4">{skill.description}</p>

            <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 text-yellow-500" />
                <span>{skill.rating}</span>
              </div>
              <div className="flex items-center gap-1">
                <Download className="w-3 h-3" />
                <span>{skill.downloads}</span>
              </div>
              <div className="flex items-center gap-1">
                {getCategoryIcon(skill.category)}
                <span>{skill.category}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 mb-4">
              {skill.tags.map((tag, index) => (
                <span key={index} className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              {skill.installed ? (
                <button className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg">
                  <Download className="w-3 h-3" />
                  Installed
                </button>
              ) : (
                <button className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                  <Download className="w-3 h-3" />
                  Install
                </button>
              )}
              <button className="p-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {filteredSkills.length === 0 && (
        <div className="text-center py-12">
          <Puzzle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No skills found</h3>
          <p className="text-muted-foreground">Try adjusting your search terms or filters.</p>
        </div>
      )}
    </div>
  );
}