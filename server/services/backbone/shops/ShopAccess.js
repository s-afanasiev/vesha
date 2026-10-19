// Кто входит в кабинет магазина (docs/backbone-architecture.md §9). Правило-объект
// (П14): ответ — вердикт с причиной. На вопрос доступа отвечает только он (П29):
// граница server/routes/backbone.js спрашивает дверь BackboneDesk, дверь — его,
// и всё это — до чтения данных магазина.
//
// Админ экземпляра — почта из ADMIN_EMAILS: все магазины, демо и экран «Магазины».
// Сотрудник — аккаунт, который принял приглашение магазина (backbone_shop_staff.user_id):
// только этот магазин. Совпадение почты входа не даёт — регистрация её не подтверждает.
// Посев из кода (демо) — только админ. Роль не зависит от плиток экспериментов.

const normalize = (email) => String(email ?? '').trim().toLowerCase() || null;

const allowed = (role) => ({ ok: true, role });
const denied = (status, reason) => ({ ok: false, status, reason });

class ShopAccess {
  constructor({ admins = [] } = {}) {
    this.admins = new Set(admins.map(normalize).filter(Boolean));
  }

  // Почта вошедшего — в том виде, в каком её хранит регистрация.
  emailOf(user) {
    return normalize(user && user.email);
  }

  isAdmin(user) {
    const email = this.emailOf(user);
    return Boolean(email) && this.admins.has(email);
  }

  // Любой экран кабинета — только после входа.
  signedIn(user) {
    if (!this.emailOf(user)) return denied(401, 'Войдите: кабинет — для сотрудников магазина');
    return allowed(this.isAdmin(user) ? 'admin' : 'staff');
  }

  // Экран «Магазины»: заводить магазины и сотрудников — только админ.
  cabinet(user) {
    const who = this.signedIn(user);
    if (!who.ok || who.role === 'admin') return who;
    return denied(403, 'Экран «Магазины» — только для админа');
  }

  // Магазин: админ — любой (неизвестный адрес ответит 404 дальше); посев — только
  // админ; сотрудник — если его аккаунт принял приглашение магазина (staff — ответ
  // репозитория по этому аккаунту и этому магазину).
  shop(user, { seed = false, staff = false } = {}) {
    const who = this.signedIn(user);
    if (!who.ok || who.role === 'admin') return who;
    if (staff && !seed) return allowed('staff');
    return denied(403, 'Этот магазин вам не открыт — попросите у админа ссылку-приглашение');
  }
}

module.exports = { ShopAccess };
