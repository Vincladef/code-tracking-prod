// Integration script to connect dopamine animations with existing tracker functionality

// Enhanced progress display with dopamine animations
function enhanceProgressBars() {
  // Find all percentage displays and progress indicators
  const progressElements = document.querySelectorAll('[data-percentage], .percentage, .progress-bar');
  
  progressElements.forEach(element => {
    const percentage = element.dataset.percentage || element.textContent.match(/(\d+)%/)?.[1];
    
    if (percentage) {
      // Create visual progress bar if it doesn't exist
      if (!element.querySelector('.dopamine-progress')) {
        const progressBar = document.createElement('div');
        progressBar.className = 'dopamine-progress';
        progressBar.style.cssText = `
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
          overflow: hidden;
          margin-top: 8px;
        `;
        
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-dopamine';
        progressFill.style.cssText = `
          height: 100%;
          width: 0%;
          transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
        `;
        
        progressBar.appendChild(progressFill);
        element.appendChild(progressBar);
        
        // Animate to target percentage
        setTimeout(() => {
          progressFill.style.width = percentage + '%';
          
          // Trigger dopamine effects for high percentages
          if (parseInt(percentage) >= 80) {
            window.Dopamine.celebrate('progress', progressFill, { width: percentage + '%' });
          }
        }, 100);
      }
    }
  });
}

// Enhance daily summary cards
function enhanceDailySummaries() {
  const summaries = document.querySelectorAll('.daily-summary, .daily-category');
  
  summaries.forEach(summary => {
    // Add hover effects
    summary.classList.add('hover-lift');
    
    // Check for completion status
    const checkboxes = summary.querySelectorAll('input[type="checkbox"]');
    const checkedBoxes = summary.querySelectorAll('input[type="checkbox"]:checked');
    
    if (checkboxes.length > 0) {
      const percentage = Math.round((checkedBoxes.length / checkboxes.length) * 100);
      
      if (percentage === 100) {
        // Perfect completion!
        summary.classList.add('celebration-dance');
        summary.style.background = 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))';
        
        // Add achievement badge
        const badge = document.createElement('div');
        badge.className = 'achievement-float';
        badge.innerHTML = '🏆';
        badge.style.cssText = `
          position: absolute;
          top: 10px;
          right: 10px;
          font-size: 24px;
          z-index: 10;
        `;
        summary.style.position = 'relative';
        summary.appendChild(badge);
      } else if (percentage >= 80) {
        // Great progress
        summary.style.background = 'linear-gradient(135deg, rgba(255, 193, 7, 0.1), rgba(255, 193, 7, 0.05))';
      }
    }
  });
}

// Enhance navigation tabs
function enhanceNavigationTabs() {
  const tabs = document.querySelectorAll('.tab, [data-nav]');
  
  tabs.forEach(tab => {
    tab.classList.add('magnetic-button');
    
    tab.addEventListener('click', function() {
      // Add ripple effect on tab change
      this.style.position = 'relative';
      const ripple = document.createElement('div');
      ripple.style.cssText = `
        position: absolute;
        border-radius: 50%;
        background: rgba(62, 166, 235, 0.3);
        transform: scale(0);
        animation: success-ripple 0.6s ease-out;
        pointer-events: none;
      `;
      
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (rect.width - size) / 2 + 'px';
      ripple.style.top = (rect.height - size) / 2 + 'px';
      
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
}

// Enhance goal sections
function enhanceGoalSections() {
  const goalElements = document.querySelectorAll('[data-section="goals"] .card, .goal-item');
  
  goalElements.forEach(goal => {
    goal.classList.add('hover-lift');
    
    // Check for goal completion or milestones
    const progressElement = goal.querySelector('[data-percentage], .percentage');
    if (progressElement) {
      const percentage = parseInt(progressElement.dataset.percentage || progressElement.textContent);
      
      if (percentage >= 100) {
        // Goal achieved!
        goal.classList.add('level-up-dopamine');
        
        // Add celebration effect
        goal.addEventListener('mouseenter', () => {
          window.Dopamine.celebrate('small', goal);
        });
      }
    }
  });
}

// Enhance streak displays
function enhanceStreakDisplays() {
  const streakElements = document.querySelectorAll('[data-streak], .streak, .consecutive-days');
  
  streakElements.forEach(element => {
    const streakCount = parseInt(element.dataset.streak || element.textContent.match(/(\d+)/)?.[1] || 0);
    
    if (streakCount > 0) {
      element.classList.add('streak-dopamine');
      
      // Celebrate milestones
      if (streakCount % 7 === 0) {
        element.classList.add('rainbow-text');
        window.Dopamine.showAchievement(`🔥 ${streakCount} jours d'affilée !`);
      }
      
      // Add hover celebration
      element.addEventListener('mouseenter', () => {
        if (streakCount >= 3) {
          window.Dopamine.celebrate('streak', element, { count: streakCount });
        }
      });
    }
  });
}

// Add floating action buttons with dopamine effects
function enhanceActionButtons() {
  const buttons = document.querySelectorAll('.btn, button:not([type="checkbox"])');
  
  buttons.forEach(button => {
    button.classList.add('magnetic-button');
    
    // Add success sound on click
    button.addEventListener('click', function() {
      if (this.classList.contains('btn-primary') || this.classList.contains('btn-success')) {
        window.dopamineEngine.playSuccessSound(523.25, 100);
      }
    });
  });
}

// Create achievement notifications for milestones
function checkForAchievements() {
  // Check total completion rate
  const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked');
  
  if (allCheckboxes.length > 0) {
    const totalPercentage = Math.round((checkedBoxes.length / allCheckboxes.length) * 100);
    
    if (totalPercentage === 100 && allCheckboxes.length > 5) {
      window.Dopamine.showAchievement('🎉 Parfait ! Toutes les tâches complétées !');
      window.Dopamine.celebrate('big');
    } else if (totalPercentage >= 80) {
      window.Dopamine.showAchievement('⭐ Excellent travail !');
    }
  }
  
  // Check for specific achievements
  const today = new Date().toDateString();
  const lastVisitKey = 'lastVisitDate';
  const streakKey = 'dailyStreak';
  
  try {
    const lastVisit = localStorage.getItem(lastVisitKey);
    let streak = parseInt(localStorage.getItem(streakKey) || '0');
    
    if (lastVisit !== today) {
      // New day!
      if (lastVisit) {
        const lastDate = new Date(lastVisit);
        const todayDate = new Date(today);
        const dayDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        
        if (dayDiff === 1) {
          streak++;
        } else {
          streak = 1;
        }
      } else {
        streak = 1;
      }
      
      localStorage.setItem(lastVisitKey, today);
      localStorage.setItem(streakKey, streak.toString());
      
      if (streak >= 3) {
        window.Dopamine.showAchievement(`🔥 ${streak} jours consécutifs !`);
      }
    }
  } catch (e) {
    // Silent fail for localStorage
  }
}

// Initialize all enhancements
function initializeDopamineEnhancements() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initializeAllEnhancements, 500);
    });
  } else {
    setTimeout(initializeAllEnhancements, 500);
  }
}

function initializeAllEnhancements() {
  enhanceProgressBars();
  enhanceDailySummaries();
  enhanceNavigationTabs();
  enhanceGoalSections();
  enhanceStreakDisplays();
  enhanceActionButtons();
  checkForAchievements();
  
  // Set up periodic checks
  setInterval(checkForAchievements, 30000); // Check every 30 seconds
  
  // Listen for navigation changes
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(initializeAllEnhancements, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
}

// Auto-initialize
initializeDopamineEnhancements();

// Export for manual triggering
window.DopamineEnhancements = {
  enhanceProgressBars,
  enhanceDailySummaries,
  enhanceNavigationTabs,
  enhanceGoalSections,
  enhanceStreakDisplays,
  enhanceActionButtons,
  checkForAchievements,
  initializeAll: initializeAllEnhancements
};
