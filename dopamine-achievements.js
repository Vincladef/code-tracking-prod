// Achievement System for Dopamine-Boosting Rewards
class DopamineAchievements {
  constructor() {
    this.achievements = new Map();
    this.unlockedAchievements = new Set();
    this.milestoneBadges = new Map();
    this.init();
  }

  init() {
    this.loadAchievements();
    this.setupAchievementListeners();
    this.createAchievementPanel();
  }

  loadAchievements() {
    try {
      const saved = localStorage.getItem('dopamine-achievements');
      if (saved) {
        const data = JSON.parse(saved);
        this.unlockedAchievements = new Set(data.unlocked || []);
      }
    } catch (e) {
      console.log('Could not load achievements');
    }

    // Define achievement types
    this.achievements.set('first-check', {
      title: '🎯 Première coche',
      description: 'Cocher votre première tâche',
      icon: '✅',
      points: 10,
      rarity: 'common'
    });

    this.achievements.set('perfect-day', {
      title: '⭐ Journée parfaite',
      description: 'Compléter toutes les tâches d\'une journée',
      icon: '🌟',
      points: 50,
      rarity: 'rare'
    });

    this.achievements.set('week-warrior', {
      title: '🔥 Guerrier de la semaine',
      description: '7 jours consécutifs de completion',
      icon: '💪',
      points: 100,
      rarity: 'epic'
    });

    this.achievements.set('streak-master', {
      title: '🏆 Maître des séries',
      description: '30 jours consécutifs',
      icon: '👑',
      points: 500,
      rarity: 'legendary'
    });

    this.achievements.set('early-bird', {
      title: '🌅 Lève-tôt',
      description: 'Compléter des tâches avant 9h',
      icon: '🐦',
      points: 25,
      rarity: 'uncommon'
    });

    this.achievements.set('night-owl', {
      title: '🦉 Hibou nocturne',
      description: 'Compléter des tâches après 21h',
      icon: '🌙',
      points: 25,
      rarity: 'uncommon'
    });

    this.achievements.set('speed-demon', {
      title: '⚡ Démon de la vitesse',
      description: 'Compléter 10 tâches en 5 minutes',
      icon: '🚀',
      points: 75,
      rarity: 'rare'
    });

    this.achievements.set('consistency-king', {
      title: '👑 Roi de la constance',
      description: 'Utiliser l\'application 7 jours par semaine pendant 4 semaines',
      icon: '⚜️',
      points: 200,
      rarity: 'epic'
    });
  }

  setupAchievementListeners() {
    // Listen for checkbox completions
    document.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox' && e.target.checked) {
        this.checkCheckboxAchievements(e.target);
      }
    });

    // Listen for dopamine events
    document.addEventListener('dopamine:celebrate', () => {
      this.checkMilestoneAchievements();
    });

    // Listen for navigation
    let lastVisit = new Date().toDateString();
    setInterval(() => {
      const today = new Date().toDateString();
      if (today !== lastVisit) {
        lastVisit = today;
        this.checkDailyAchievements();
      }
    }, 60000); // Check every minute
  }

  checkCheckboxAchievements(checkbox) {
    const totalCheckboxes = document.querySelectorAll('input[type="checkbox"]').length;
    const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked').length;

    // First checkbox achievement
    if (checkedBoxes === 1 && !this.isUnlocked('first-check')) {
      this.unlock('first-check');
    }

    // Perfect day check
    if (totalCheckboxes > 0 && totalCheckboxes === checkedBoxes) {
      if (!this.isUnlocked('perfect-day')) {
        this.unlock('perfect-day');
      }
    }

    // Speed demon check
    const now = Date.now();
    if (!this.speedCheckStart) {
      this.speedCheckStart = now;
      this.speedCheckCount = 1;
    } else {
      this.speedCheckCount++;
      if (now - this.speedCheckStart <= 300000 && this.speedCheckCount >= 10) { // 5 minutes
        if (!this.isUnlocked('speed-demon')) {
          this.unlock('speed-demon');
        }
      }
    }

    // Time-based achievements
    const hour = new Date().getHours();
    if (hour < 9 && !this.isUnlocked('early-bird')) {
      this.unlock('early-bird');
    } else if (hour >= 21 && !this.isUnlocked('night-owl')) {
      this.unlock('night-owl');
    }
  }

  checkMilestoneAchievements() {
    // Check streak achievements
    const streak = this.getCurrentStreak();
    
    if (streak >= 7 && !this.isUnlocked('week-warrior')) {
      this.unlock('week-warrior');
    }
    
    if (streak >= 30 && !this.isUnlocked('streak-master')) {
      this.unlock('streak-master');
    }

    // Check consistency
    const consistency = this.getConsistencyScore();
    if (consistency >= 28 && !this.isUnlocked('consistency-king')) { // 4 weeks of daily usage
      this.unlock('consistency-king');
    }
  }

  checkDailyAchievements() {
    // This would be called when a new day starts
    this.checkMilestoneAchievements();
  }

  getCurrentStreak() {
    try {
      return parseInt(localStorage.getItem('dailyStreak') || '0');
    } catch (e) {
      return 0;
    }
  }

  getConsistencyScore() {
    try {
      return parseInt(localStorage.getItem('consistencyDays') || '0');
    } catch (e) {
      return 0;
    }
  }

  isUnlocked(achievementId) {
    return this.unlockedAchievements.has(achievementId);
  }

  unlock(achievementId) {
    if (this.isUnlocked(achievementId)) return;

    const achievement = this.achievements.get(achievementId);
    if (!achievement) return;

    this.unlockedAchievements.add(achievementId);
    this.saveAchievements();
    this.showAchievementNotification(achievement);
    this.createFloatingBadge(achievement);
    
    // Trigger celebration
    if (achievement.rarity === 'legendary' || achievement.rarity === 'epic') {
      window.Dopamine.celebrate('big');
    } else {
      window.Dopamine.celebrate('small');
    }
  }

  saveAchievements() {
    try {
      localStorage.setItem('dopamine-achievements', JSON.stringify({
        unlocked: Array.from(this.unlockedAchievements)
      }));
    } catch (e) {
      console.log('Could not save achievements');
    }
  }

  showAchievementNotification(achievement) {
    const notification = document.createElement('div');
    notification.className = 'achievement-notification';
    notification.innerHTML = `
      <div class="achievement-popup">
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-content">
          <div class="achievement-title">${achievement.title}</div>
          <div class="achievement-description">${achievement.description}</div>
          <div class="achievement-points">+${achievement.points} points</div>
        </div>
      </div>
    `;

    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      animation: achievementSlideIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    `;

    // Add popup styles
    const style = document.createElement('style');
    style.textContent = `
      .achievement-popup {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 300px;
        position: relative;
        overflow: hidden;
      }
      
      .achievement-popup::before {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
        animation: achievementShimmer 2s infinite;
      }
      
      .achievement-icon {
        font-size: 48px;
        z-index: 1;
      }
      
      .achievement-content {
        z-index: 1;
      }
      
      .achievement-title {
        font-weight: bold;
        font-size: 18px;
        margin-bottom: 4px;
      }
      
      .achievement-description {
        font-size: 14px;
        opacity: 0.9;
        margin-bottom: 8px;
      }
      
      .achievement-points {
        font-weight: bold;
        color: #ffd700;
      }
      
      @keyframes achievementSlideIn {
        0% {
          transform: translateX(100%) rotate(5deg);
          opacity: 0;
        }
        100% {
          transform: translateX(0) rotate(0deg);
          opacity: 1;
        }
      }
      
      @keyframes achievementShimmer {
        0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
        100% { transform: translateX(100%) translateY(100%) rotate(45deg); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'achievementSlideIn 0.5s reverse';
      setTimeout(() => {
        notification.remove();
        style.remove();
      }, 500);
    }, 5000);
  }

  createFloatingBadge(achievement) {
    const badge = document.createElement('div');
    badge.className = 'floating-achievement-badge';
    badge.innerHTML = achievement.icon;
    
    badge.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      font-size: 32px;
      z-index: 9999;
      animation: badgeFloat 3s ease-in-out;
      pointer-events: none;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes badgeFloat {
        0% {
          transform: translateY(100px) scale(0) rotate(0deg);
          opacity: 0;
        }
        50% {
          transform: translateY(0) scale(1.2) rotate(180deg);
          opacity: 1;
        }
        100% {
          transform: translateY(-50px) scale(0.8) rotate(360deg);
          opacity: 0;
        }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(badge);

    setTimeout(() => {
      badge.remove();
      style.remove();
    }, 3000);
  }

  createAchievementPanel() {
    // Create achievement panel button
    const panelButton = document.createElement('button');
    panelButton.innerHTML = '🏆';
    panelButton.title = 'Succès';
    panelButton.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      z-index: 1000;
      transition: all 0.3s ease;
    `;

    panelButton.addEventListener('mouseenter', () => {
      panelButton.style.transform = 'scale(1.1) rotate(10deg)';
    });

    panelButton.addEventListener('mouseleave', () => {
      panelButton.style.transform = 'scale(1) rotate(0deg)';
    });

    panelButton.addEventListener('click', () => {
      this.showAchievementPanel();
    });

    document.body.appendChild(panelButton);
  }

  showAchievementPanel() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: white;
      border-radius: 20px;
      padding: 30px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 15px;
      right: 15px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
    `;

    closeBtn.addEventListener('click', () => {
      overlay.remove();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    const title = document.createElement('h2');
    title.textContent = '🏆 Succès';
    title.style.cssText = `
      margin: 0 0 20px 0;
      color: #333;
      font-size: 28px;
    `;

    const stats = document.createElement('div');
    stats.innerHTML = `
      <p style="margin: 0 0 20px 0; color: #666;">
        ${this.unlockedAchievements.size} / ${this.achievements.size} succès débloqués
      </p>
    `;

    const achievementsList = document.createElement('div');
    achievementsList.style.cssText = `
      display: grid;
      gap: 15px;
    `;

    // Render all achievements
    this.achievements.forEach((achievement, id) => {
      const isUnlocked = this.isUnlocked(id);
      const achievementEl = document.createElement('div');
      achievementEl.style.cssText = `
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 15px;
        border-radius: 12px;
        background: ${isUnlocked ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f5f5f5'};
        color: ${isUnlocked ? 'white' : '#666'};
        opacity: ${isUnlocked ? '1' : '0.6'};
        transition: all 0.3s ease;
      `;

      if (isUnlocked) {
        achievementEl.addEventListener('mouseenter', () => {
          achievementEl.style.transform = 'scale(1.02)';
          achievementEl.style.boxShadow = '0 8px 24px rgba(102, 126, 234, 0.3)';
        });

        achievementEl.addEventListener('mouseleave', () => {
          achievementEl.style.transform = 'scale(1)';
          achievementEl.style.boxShadow = 'none';
        });
      }

      achievementEl.innerHTML = `
        <div style="font-size: 32px;">${achievement.icon}</div>
        <div style="flex: 1;">
          <div style="font-weight: bold; margin-bottom: 4px;">${achievement.title}</div>
          <div style="font-size: 14px; opacity: 0.8;">${achievement.description}</div>
          <div style="font-size: 12px; margin-top: 4px; color: ${isUnlocked ? '#ffd700' : '#999'};">
            ${achievement.points} points • ${this.getRarityLabel(achievement.rarity)}
          </div>
        </div>
        ${isUnlocked ? '<div style="font-size: 24px;">✅</div>' : '<div style="font-size: 24px;">🔒</div>'}
      `;

      achievementsList.appendChild(achievementEl);
    });

    panel.appendChild(closeBtn);
    panel.appendChild(title);
    panel.appendChild(stats);
    panel.appendChild(achievementsList);
    overlay.appendChild(panel);

    document.body.appendChild(overlay);
  }

  getRarityLabel(rarity) {
    const labels = {
      common: 'Commun',
      uncommon: 'Peu commun',
      rare: 'Rare',
      epic: 'Épique',
      legendary: 'Légendaire'
    };
    return labels[rarity] || rarity;
  }

  // Public API
  getTotalPoints() {
    let total = 0;
    this.unlockedAchievements.forEach(id => {
      const achievement = this.achievements.get(id);
      if (achievement) {
        total += achievement.points;
      }
    });
    return total;
  }
}

// Initialize the achievement system
window.dopamineAchievements = new DopamineAchievements();

// Make it globally available
window.Achievements = {
  unlock: (id) => window.dopamineAchievements.unlock(id),
  isUnlocked: (id) => window.dopamineAchievements.isUnlocked(id),
  getTotalPoints: () => window.dopamineAchievements.getTotalPoints(),
  showPanel: () => window.dopamineAchievements.showAchievementPanel()
};
