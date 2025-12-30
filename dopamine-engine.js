// Dopamine Engine - Powers satisfying animations and micro-interactions
class DopamineEngine {
  constructor() {
    this.confettiContainer = null;
    this.audioContext = null;
    this.init();
  }

  init() {
    this.createConfettiContainer();
    this.setupGlobalListeners();
    this.initializeAudio();
  }

  createConfettiContainer() {
    this.confettiContainer = document.createElement('div');
    this.confettiContainer.className = 'confetti-container';
    document.body.appendChild(this.confettiContainer);
  }

  initializeAudio() {
    try {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
    } catch (e) {
      console.log('Audio not supported');
    }
  }

  playSuccessSound(frequency = 523.25, duration = 200) {
    if (!this.audioContext) return;
    
    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);
      
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration / 1000);
    } catch (e) {
      // Silent fail for audio
    }
  }

  triggerCheckboxCompletion(checkbox) {
    // Visual feedback
    checkbox.classList.add('checkbox-dopamine');
    setTimeout(() => checkbox.classList.remove('checkbox-dopamine'), 600);

    // Create ripple effect
    this.createRipple(checkbox);

    // Play success sound
    this.playSuccessSound(523.25, 150);
    setTimeout(() => this.playSuccessSound(659.25, 100), 100);

    // Small confetti burst
    this.createMiniConfetti(checkbox, 5);
  }

  createRipple(element) {
    const ripple = document.createElement('div');
    ripple.className = 'success-ripple';
    
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = rect.left + rect.width / 2 - size / 2 + 'px';
    ripple.style.top = rect.top + rect.height / 2 - size / 2 + 'px';
    
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 1000);
  }

  createMiniConfetti(element, count = 10) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    for (let i = 0; i < count; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti-piece';
      
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3'];
      confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
      
      const angle = (Math.PI * 2 * i) / count;
      const velocity = 100 + Math.random() * 100;
      
      confetti.style.left = centerX + 'px';
      confetti.style.top = centerY + 'px';
      
      this.confettiContainer.appendChild(confetti);
      
      // Animate burst
      let x = 0, y = 0;
      let opacity = 1;
      let rotation = 0;
      
      const animate = () => {
        x += Math.cos(angle) * velocity * 0.02;
        y += Math.sin(angle) * velocity * 0.02 - 2; // Gravity effect
        opacity -= 0.02;
        rotation += 10;
        
        confetti.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
        confetti.style.opacity = opacity;
        
        if (opacity > 0) {
          requestAnimationFrame(animate);
        } else {
          confetti.remove();
        }
      };
      
      requestAnimationFrame(animate);
    }
  }

  triggerBigCelebration() {
    // Full screen confetti
    this.createFullConfetti();
    
    // Play celebration sound
    this.playSuccessSound(523.25, 200);
    setTimeout(() => this.playSuccessSound(659.25, 200), 150);
    setTimeout(() => this.playSuccessSound(783.99, 300), 300);
    
    // Show achievement notification
    this.showAchievementNotification('🎉 Objectif atteint !');
  }

  createFullConfetti() {
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti-piece';
        
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd'];
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDuration = (2 + Math.random() * 2) + 's';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        
        this.confettiContainer.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 4000);
      }, i * 50);
    }
  }

  showAchievementNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 z-50 card px-6 py-4 shadow-2xl success-slide-in';
    notification.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="text-2xl">🏆</div>
        <div>
          <div class="font-bold text-lg rainbow-text">${message}</div>
          <div class="text-sm opacity-75">Continuez comme ça !</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      notification.style.animation = 'success-notification 0.5s reverse';
      setTimeout(() => notification.remove(), 500);
    }, 4000);
  }

  animateProgressBar(progressBar, targetWidth) {
    progressBar.classList.add('progress-dopamine');
    progressBar.style.width = targetWidth;
    
    // Create sparkles along the progress
    const rect = progressBar.getBoundingClientRect();
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.createSparkle(rect.left + Math.random() * rect.width, rect.top);
      }, i * 200);
    }
  }

  createSparkle(x, y) {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = x + 'px';
    sparkle.style.top = y + 'px';
    
    document.body.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 1500);
  }

  addMagneticEffect(button) {
    button.classList.add('magnetic-button');
    
    button.addEventListener('mouseenter', () => {
      this.playSuccessSound(440, 50);
    });
  }

  celebrateStreak(element, streakCount) {
    element.classList.add('streak-dopamine');
    
    if (streakCount % 7 === 0) { // Weekly celebration
      this.triggerBigCelebration();
      this.showAchievementNotification(`🔥 ${streakCount} jours d'affilée !`);
    } else if (streakCount % 3 === 0) { // Mini celebration
      this.createMiniConfetti(element, 8);
      this.playSuccessSound(587.33, 150);
    }
  }

  levelUpAnimation(element) {
    element.classList.add('level-up-dopamine');
    this.triggerBigCelebration();
  }

  addHoverEffects(elements) {
    elements.forEach(element => {
      element.classList.add('hover-lift');
    });
  }

  setupGlobalListeners() {
    // Listen for checkbox changes
    document.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox' && e.target.checked) {
        this.triggerCheckboxCompletion(e.target);
        
        // Check if this completes a section
        const section = e.target.closest('.daily-category, .consigne-group');
        if (section) {
          this.checkSectionCompletion(section);
        }
      }
    });

    // Listen for button clicks
    document.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        const button = e.target.tagName === 'BUTTON' ? e.target : e.target.closest('button');
        this.addMagneticEffect(button);
      }
    });

    // Listen for custom dopamine events
    document.addEventListener('dopamine:celebrate', (e) => {
      this.triggerBigCelebration();
    });

    document.addEventListener('dopamine:streak', (e) => {
      this.celebrateStreak(e.detail.element, e.detail.count);
    });

    document.addEventListener('dopamine:levelup', (e) => {
      this.levelUpAnimation(e.detail.element);
    });
  }

  checkSectionCompletion(section) {
    const checkboxes = section.querySelectorAll('input[type="checkbox"]');
    const checkedBoxes = section.querySelectorAll('input[type="checkbox"]:checked');
    
    if (checkboxes.length > 0 && checkboxes.length === checkedBoxes.length) {
      // Section completed!
      section.classList.add('celebration-dance');
      this.createMiniConfetti(section, 15);
      this.playSuccessSound(783.99, 200);
      
      setTimeout(() => {
        section.classList.remove('celebration-dance');
      }, 1000);
    }
  }

  // Public API for manual triggering
  celebrate(type = 'small', element = null, data = {}) {
    switch (type) {
      case 'big':
        this.triggerBigCelebration();
        break;
      case 'checkbox':
        if (element) this.triggerCheckboxCompletion(element);
        break;
      case 'streak':
        if (element) this.celebrateStreak(element, data.count || 1);
        break;
      case 'levelup':
        if (element) this.levelUpAnimation(element);
        break;
      case 'progress':
        if (element) this.animateProgressBar(element, data.width || '100%');
        break;
      default:
        this.createMiniConfetti(element || document.body, 10);
    }
  }
}

// Initialize the dopamine engine
window.dopamineEngine = new DopamineEngine();

// Make it globally available
window.Dopamine = {
  celebrate: (type, element, data) => window.dopamineEngine.celebrate(type, element, data),
  triggerBigCelebration: () => window.dopamineEngine.triggerBigCelebration(),
  showAchievement: (message) => window.dopamineEngine.showAchievementNotification(message)
};
