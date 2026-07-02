import { Lightbulb, TrendingUp, Gift, Star, Sparkles } from 'lucide-react';

interface Recommendation {
  type: 'maintenance' | 'winback' | 'premium' | 'repeat_service' | 'welcome';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

interface CustomerRecommendationProps {
  recommendation: Recommendation;
}

export default function CustomerRecommendation({ recommendation }: CustomerRecommendationProps) {
  const getRecommendationStyle = () => {
    switch (recommendation.priority) {
      case 'high':
        return {
          bg: 'bg-warning/10',
          border: 'border-warning/30',
          text: 'text-warning',
          icon: TrendingUp,
        };
      case 'medium':
        return {
          bg: 'bg-info/10',
          border: 'border-info/30',
          text: 'text-info',
          icon: Star,
        };
      default:
        return {
          bg: 'bg-muted',
          border: 'border-border',
          text: 'text-muted-foreground',
          icon: Lightbulb,
        };
    }
  };

  const getTypeIcon = () => {
    switch (recommendation.type) {
      case 'winback':
        return TrendingUp;
      case 'premium':
        return Star;
      case 'welcome':
        return Sparkles;
      case 'repeat_service':
        return Gift;
      default:
        return Lightbulb;
    }
  };

  const style = getRecommendationStyle();
  const Icon = getTypeIcon();

  return (
    <div
      className={`p-3 rounded-lg border ${style.border} ${style.bg}`}
      dir="rtl"
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 ${style.text} shrink-0 mt-0.5`} />
        <div className="flex-1">
          <h4 className={`text-xs font-bold ${style.text} mb-1`}>
            توصية ذكية
          </h4>
          <p className="text-xs leading-relaxed">
            {recommendation.message}
          </p>
        </div>
      </div>
    </div>
  );
}
