/* Life Dashboard — interface. JavaScript puro, sem etapa de build.
   Escrito para rodar também em navegadores mais antigos (sem ?. e ??). */
(function () {
  'use strict';

  var TOKEN_KEY = 'lifedash_token';
  var state = { areas: [], health: null, weekRef: null };

  // ---------- utilidades ----------
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* sem armazenamento */ } }

  function api(method, path, body) {
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401) { showLogin(); throw new Error(data.error || 'Não autorizado'); }
          if (!res.ok) { var err = new Error(data.error || ('Erro ' + res.status)); err.status = res.status; err.details = data.details; throw err; }
          return data;
        });
      });
  }

  // Monta elementos sem usar innerHTML com dados (evita injeção de código).
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function toast(msg, kind) {
    var t = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    document.getElementById('toasts').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'err' ? 5000 : 2800);
  }
  function fail(err) { toast(err.message || String(err), 'err'); }

  var WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var WD_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function parseD(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtShort(s) { var d = parseD(s); return WD[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1); }
  function fmtDay(s) { var d = parseD(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function todayISO() { return state.health ? state.health.today : iso(new Date()); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }

  // ---------- celebração de XP ----------
  var lastLevel = null;
  function celebrate(xpEntry, before) {
    if (xpEntry && xpEntry.amount > 0) toast('+' + xpEntry.amount + ' XP', 'xp');
    else if (xpEntry && xpEntry.amount === 0 && xpEntry.note) toast('Concluída! (' + xpEntry.note + ')');
    return api('GET', '/api/xp').then(function (x) {
      var prev = before !== undefined ? before : lastLevel;
      if (prev !== null && x.level > prev) toast('🎉 Nível ' + x.level + ' — ' + x.title + '!', 'xp');
      lastLevel = x.level;
    });
  }

  // ---------- ações de tarefa ----------
  function toggleTask(t) {
    if (t.status === 'done') {
      return api('POST', '/api/tasks/' + t.id + '/reopen', {}).then(function (r) {
        if (r.reversal && r.reversal.amount) toast('Tarefa reaberta (' + r.reversal.amount + ' XP estornado)');
        return celebrate(null);
      });
    }
    return api('POST', '/api/tasks/' + t.id + '/complete', {}).catch(function (err) {
      if (err.status === 409 && err.details && err.details.pending) {
        var names = err.details.pending.map(function (p) { return '• ' + p.title; }).join('\n');
        if (confirm('Ainda há subdivisões pendentes:\n' + names + '\n\nConcluir tudo junto?')) {
          return api('POST', '/api/tasks/' + t.id + '/complete', { cascade: true });
        }
        return null;
      }
      throw err;
    }).then(function (r) { if (r) return celebrate(r.xp); });
  }

  function togglePriority(t) {
    return api('PATCH', '/api/tasks/' + t.id, { is_priority: !t.is_priority });
  }

  function taskRow(t, opts) {
    opts = opts || {};
    var today = todayISO();
    var chips = [];
    if (t.area_name && !opts.hideArea) chips.push(h('span', { class: 'chip area', style: 'border-left-color:' + t.area_color }, (t.area_icon || '') + ' ' + t.area_name));
    if (t.planned_date && opts.showPlanned !== false) chips.push(h('span', { class: 'chip' }, 'plan. ' + fmtShort(t.planned_date)));
    if (t.due_date) chips.push(h('span', { class: 'chip' + (t.status === 'pending' && t.due_date < today ? ' late' : '') }, 'prazo ' + fmtShort(t.due_date)));
    if (t.subtasks && t.subtasks.total) chips.push(h('span', { class: 'chip' }, '☰ ' + t.subtasks.done + '/' + t.subtasks.total));
    if (t.granularity !== 'task') chips.push(h('span', { class: 'chip' }, t.granularity === 'subtask' ? 'subtarefa' : 'micro'));
    return h('li', { class: 'task' + (t.status === 'done' ? ' done' : ''), 'data-id': t.id },
      h('button', {
        class: 'check', title: t.status === 'done' ? 'Reabrir' : 'Concluir', 'aria-label': t.status === 'done' ? 'Reabrir' : 'Concluir',
        onclick: function () { toggleTask(t).then(opts.afterToggle || refresh).catch(fail); },
      }, t.status === 'done' ? '✓' : ''),
      h('div', { class: 'task-main' },
        h('div', { class: 'task-title', onclick: function () { (opts.onOpen || openTask)(t.id); } }, t.title),
        chips.length ? h('div', { class: 'meta' }, chips) : null),
      t.status === 'pending' && !opts.noStar ? h('button', {
        class: 'star' + (t.is_priority ? ' on' : ''), title: t.is_priority ? 'Tirar das prioridades' : 'Marcar como prioridade',
        onclick: function () { togglePriority(t).then(refresh).catch(fail); },
      }, '⭐') : null);
  }

  function areaSelect(value, allowEmpty) {
    var sel = h('select', { 'aria-label': 'Área' });
    if (allowEmpty !== false) sel.appendChild(h('option', { value: '' }, 'Sem área'));
    state.areas.forEach(function (a) { sel.appendChild(h('option', { value: String(a.id) }, a.icon + ' ' + a.name)); });
    sel.value = value ? String(value) : '';
    return sel;
  }

  function quickAdd(defaults) {
    defaults = defaults || {};
    var title = h('input', { type: 'text', placeholder: 'Nova tarefa… (ex.: Estudar capítulo 3)', 'aria-label': 'Nova tarefa', maxlength: '300' });
    var area = areaSelect(defaults.area_id);
    var date = h('input', { type: 'date', value: defaults.planned_date === undefined ? todayISO() : (defaults.planned_date || ''), 'aria-label': 'Data planejada', title: 'Data planejada' });
    var prio = h('input', { type: 'checkbox' });
    function submit(e) {
      e.preventDefault();
      if (!title.value.trim()) { title.focus(); return; }
      api('POST', '/api/tasks', {
        title: title.value, area_id: area.value ? Number(area.value) : null,
        planned_date: date.value || null, is_priority: prio.checked,
        project_id: defaults.project_id || undefined,
      }).then(function () { title.value = ''; prio.checked = false; toast('Tarefa criada'); return refresh(); }).catch(fail);
    }
    return h('form', { class: 'quick-add', onsubmit: submit },
      title, area, date, h('label', { class: 'inline small', title: 'Prioridade' }, prio, '⭐'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Adicionar'));
  }

  // ---------- telas ----------
  var current = { render: null };
  function refresh() { return current.render ? current.render(true) : Promise.resolve(); }

  function viewWeek(app, ref) {
    return api('GET', '/api/overview' + (ref ? '?date=' + ref : '')).then(function (o) {
      state.weekRef = o.week.start;
      if (lastLevel === null) lastLevel = o.xp.level;
      clear(app);

      // 1) semana e visão geral
      var c = o.counts;
      var pct = c.planned ? Math.round((c.done / c.planned) * 100) : 0;
      var weekCard = h('section', { class: 'card' },
        h('div', { class: 'week-nav' },
          h('button', { class: 'btn btn-sm', 'aria-label': 'Semana anterior', onclick: function () { go(addDays(o.week.start, -7)); } }, '‹'),
          h('h1', null, (o.week.is_current ? 'Esta semana' : 'Semana') + ' · ' + fmtDay(o.week.start) + ' – ' + fmtDay(o.week.end)),
          h('button', { class: 'btn btn-sm', 'aria-label': 'Próxima semana', onclick: function () { go(addDays(o.week.start, 7)); } }, '›'),
          o.week.is_current ? null : h('button', { class: 'btn btn-sm', onclick: function () { go(null); } }, 'Hoje')),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, c.planned), h('span', null, 'na semana')),
          h('div', { class: 'stat good' }, h('b', null, c.done), h('span', null, 'concluídas')),
          h('div', { class: 'stat' }, h('b', null, c.pending), h('span', null, 'pendentes')),
          c.overdue ? h('div', { class: 'stat warn' }, h('b', null, c.overdue), h('span', null, 'prazo vencido')) : null),
        h('div', { style: 'margin-top:.75rem' },
          h('div', { class: 'bar', title: pct + '% concluído' }, h('i', { style: 'width:' + pct + '%' })),
          h('div', { class: 'small muted', style: 'margin-top:.25rem' }, pct + '% do que estava na semana já foi feito')));

      // 2) XP e 3) nível
      var x = o.xp;
      var xpCard = h('section', { class: 'card xp-card' },
        h('div', { class: 'xp-total' }, h('b', null, x.total_xp), h('span', null, 'XP'), h('span', { class: 'muted small' }, '+' + x.week + ' nesta semana')),
        h('div', { class: 'level-line' },
          h('span', null, h('span', { class: 'level-badge' }, 'Nível ' + x.level), ' ', h('strong', null, x.title)),
          h('span', { class: 'small muted' }, x.xp_into_level + ' / ' + (x.next_level_xp - x.level_floor_xp))),
        h('div', { class: 'bar xp lg', title: Math.round(x.progress * 100) + '%' }, h('i', { style: 'width:' + Math.round(x.progress * 100) + '%' })),
        h('div', { class: 'small muted' }, 'Faltam ' + x.xp_to_next + ' XP para o nível ' + (x.level + 1) + (x.next_title ? ' · próximo título: ' + x.next_title.title + ' (nível ' + x.next_title.level + ')' : '')),
        o.season ? h('div', { class: 'small' }, '🏁 ' + o.season.name + ': ' + o.season.xp + (o.season.xp_goal ? ' / ' + o.season.xp_goal + ' XP' : ' XP') + ' · ' + plural(o.season.days_left, 'dia restante', 'dias restantes')) : null);

      // 4) prioridades
      var prioCard = h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, '⭐ Prioridades'), h('span', { class: 'small muted hide-mobile' }, 'toque na estrela de uma tarefa para marcar')),
        o.priorities.length ? h('ul', { class: 'task-list' }, o.priorities.slice(0, 7).map(function (t) { return taskRow(t); }))
          : h('p', { class: 'empty' }, 'Nenhuma prioridade marcada. Escolha até 3 coisas que fariam esta semana valer a pena.'),
        o.priorities.length > 7 ? h('p', { class: 'small muted' }, '+ ' + (o.priorities.length - 7) + ' outras prioridades') : null);

      // 5) lista de tarefas da semana
      // Tarefas com prazo vencido aparecem só na seção própria, sem repetir no dia.
      var overdueIds = {};
      o.overdue.forEach(function (t) { overdueIds[t.id] = true; });
      var days = o.week.days.map(function (d0) {
        var d = { date: d0.date, is_today: d0.is_today, tasks: d0.tasks.filter(function (t) { return !overdueIds[t.id]; }) };
        var past = d.date < o.today;
        if (past && !d.tasks.length) return null;
        return h('div', { class: 'day' + (d.is_today ? ' today' : '') + (past ? ' past' : '') },
          h('div', { class: 'day-head' }, h('span', null, (d.is_today ? 'Hoje · ' : '') + WD_FULL[parseD(d.date).getDay()] + ' ' + fmtDay(d.date)),
            h('span', { class: 'small muted' }, d.tasks.length ? d.tasks.filter(function (t) { return t.status === 'done'; }).length + '/' + d.tasks.length : '')),
          d.tasks.length ? h('ul', { class: 'task-list' }, d.tasks.map(function (t) { return taskRow(t, { showPlanned: false }); }))
            : h('div', { class: 'day-empty' }, 'Livre'));
      });
      var extra = [];
      if (o.overdue.length) extra.push(section('⚠ Prazo vencido (' + o.overdue.length + ')', o.overdue, true));
      if (o.carried_over.length) extra.push(section('Ficaram de semanas anteriores (' + o.carried_over.length + ')', o.carried_over, false));
      if (o.unscheduled.length) extra.push(section('Sem data (' + o.unscheduled.length + ')', o.unscheduled, false));
      var tasksCard = h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Tarefas da semana')),
        quickAdd({ planned_date: o.week.is_current ? o.today : o.week.start }),
        extra, days);

      // Secundário: atenção por área e hábitos
      var areaCard = h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Áreas nesta semana'), h('a', { href: '#/areas', class: 'small' }, 'ver áreas')),
        h('div', { class: 'area-strip' }, o.areas.map(function (a) {
          var quiet = a.done_week === 0;
          var hint = a.days_since_activity === null ? 'sem registros ainda' : (a.days_since_activity === 0 ? 'atividade hoje' : 'última atividade há ' + plural(a.days_since_activity, 'dia', 'dias'));
          return h('a', { class: 'area-pill' + (quiet ? ' quiet' : ''), href: '#/area/' + a.id, title: hint },
            a.icon, ' ', a.name, ' ', h('b', null, a.done_week ? '✓' + a.done_week : '·'));
        })),
        h('p', { class: 'small muted', style: 'margin:.5rem 0 0' }, 'Áreas apagadas só indicam que não houve conclusões nesta semana. Nem toda semana precisa de todas as áreas.'));
      var habitsCard = o.habits.length ? h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Hábitos de hoje'), h('a', { href: '#/habitos', class: 'small' }, 'semana completa')),
        o.habits.map(function (hb) {
          var todayCheck = hb.week.filter(function (d) { return d.date === o.today; })[0];
          return h('div', { class: 'habit' },
            h('span', { class: 'habit-name' }, hb.title, ' ', h('span', { class: 'small muted' }, hb.week_count + '/' + hb.target_per_week + ' na semana')),
            todayCheck ? habitDot(hb, todayCheck, o.today) : null);
        })) : null;

      append(app, [
        h('div', { class: 'grid grid-hero' }, weekCard, xpCard),
        h('div', { style: 'height:1rem' }),
        prioCard, tasksCard, h('div', { class: 'grid grid-2' }, areaCard, habitsCard || h('div')),
      ]);
    });

    function section(title, tasks, open) {
      return h('details', { class: 'section', open: open },
        h('summary', null, title),
        h('ul', { class: 'task-list' }, tasks.map(function (t) { return taskRow(t); })));
    }
    function go(d) { location.hash = d ? '#/semana/' + d : '#/'; }
  }

  function habitDot(hb, day, today) {
    var future = day.date > today;
    return h('button', {
      class: 'dot' + (day.done ? ' on' : '') + (day.date === today ? ' today' : ''),
      disabled: future, title: fmtShort(day.date), 'aria-label': hb.title + ' ' + fmtShort(day.date) + (day.done ? ' feito' : ''),
      onclick: function () {
        var path = '/api/habits/' + hb.id + (day.done ? '/uncheck' : '/check');
        api('POST', path, { date: day.date }).then(function (r) { return r.xp ? celebrate(r.xp) : null; }).then(refresh).catch(fail);
      },
    }, WD[parseD(day.date).getDay()].charAt(0).toUpperCase());
  }

  function viewAreas(app) {
    return api('GET', '/api/overview').then(function (o) {
      clear(app);
      append(app, [
        h('h1', null, 'Áreas da vida'),
        h('p', { class: 'muted' }, 'Cada área guarda seus objetivos, metas, projetos e tarefas.'),
        h('div', { class: 'grid grid-areas' }, o.areas.map(function (a) {
          return h('a', { class: 'card area-card', href: '#/area/' + a.id, style: 'border-left-color:' + a.color + ';color:inherit' },
            h('h2', null, h('span', { class: 'area-icon' }, a.icon), a.name),
            h('div', { class: 'small' }, plural(a.pending_total, 'tarefa pendente', 'tarefas pendentes')),
            h('div', { class: 'small' }, plural(a.done_week, 'concluída', 'concluídas') + ' nesta semana'),
            h('div', { class: 'small muted' }, a.days_since_activity === null ? 'Sem atividade registrada ainda' : (a.days_since_activity === 0 ? 'Atividade hoje' : 'Última atividade há ' + plural(a.days_since_activity, 'dia', 'dias'))));
        })),
      ]);
    });
  }

  function viewArea(app, id) {
    return api('GET', '/api/areas/' + id).then(function (d) {
      clear(app);
      var a = d.area;
      function planList(kind, items, label, extraFields) {
        var title = h('input', { type: 'text', placeholder: 'Novo(a) ' + label.toLowerCase() + '…', maxlength: '200' });
        var extra = extraFields ? extraFields() : null;
        return h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, label + 's')),
          items.length ? items.map(function (it) {
            return h('div', { class: 'plan-item' },
              h('div', { class: 'row' },
                h('strong', { class: 'grow' }, it.title),
                h('select', {
                  'aria-label': 'Status', onchange: function (e) { api('PATCH', '/api/plan/' + kind + '/' + it.id, { status: e.target.value }).then(refresh).catch(fail); },
                }, [['active', 'ativo'], ['paused', 'pausado'], ['done', 'concluído'], ['dropped', 'abandonado']].map(function (s) {
                  var o = h('option', { value: s[0] }, s[1]); if (it.status === s[0]) o.selected = true; return o;
                }))),
              it.description ? h('div', { class: 'small muted' }, it.description) : null,
              it.target_date ? h('div', { class: 'small muted' }, 'Data-alvo: ' + fmtShort(it.target_date)) : null,
              it.note_path ? h('div', { class: 'small muted' }, '📝 ' + it.note_path) : null);
          }) : h('p', { class: 'empty' }, 'Nenhum(a) ainda.'),
          h('form', {
            class: 'row', style: 'margin-top:.5rem', onsubmit: function (e) {
              e.preventDefault();
              if (!title.value.trim()) return;
              var body = { title: title.value, area_id: a.id };
              if (extra) Object.keys(extra.values()).forEach(function (k) { body[k] = extra.values()[k]; });
              api('POST', '/api/plan/' + kind, body).then(function () { toast(label + ' criado(a)'); return refresh(); }).catch(fail);
            },
          }, h('div', { class: 'grow' }, title), extra ? extra.el : null, h('button', { class: 'btn', type: 'submit' }, 'Adicionar')));
      }
      function parentPicker(list, field, emptyLabel) {
        return function () {
          var sel = h('select', { 'aria-label': emptyLabel }, h('option', { value: '' }, emptyLabel));
          list.filter(function (x) { return x.status === 'active'; }).forEach(function (x) { sel.appendChild(h('option', { value: String(x.id) }, x.title)); });
          return { el: sel, values: function () { var v = {}; if (sel.value) v[field] = Number(sel.value); return v; } };
        };
      }
      append(app, [
        h('p', null, h('a', { href: '#/areas' }, '‹ Áreas')),
        h('h1', { style: 'border-left:6px solid ' + a.color + ';padding-left:.6rem' }, a.icon + ' ' + a.name),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Tarefas pendentes')),
          quickAdd({ area_id: a.id, planned_date: '' }),
          d.tasks.length ? h('ul', { class: 'task-list', style: 'margin-top:.5rem' }, d.tasks.map(function (t) { return taskRow(t, { hideArea: true }); }))
            : h('p', { class: 'empty' }, 'Nenhuma tarefa pendente nesta área.')),
        h('div', { class: 'grid grid-2' },
          planList('objective', d.objectives, 'Objetivo'),
          planList('goal', d.goals, 'Meta', parentPicker(d.objectives, 'objective_id', 'Objetivo (opcional)'))),
        h('div', { style: 'height:1rem' }),
        planList('project', d.projects, 'Projeto', parentPicker(d.goals, 'goal_id', 'Meta (opcional)')),
        d.done_recent.length ? h('section', { class: 'card' }, h('h2', null, 'Concluídas recentemente'),
          h('ul', { class: 'task-list' }, d.done_recent.map(function (t) { return taskRow(t, { hideArea: true }); }))) : null,
      ]);
    });
  }

  function viewHabits(app) {
    return api('GET', '/api/habits').then(function (list) {
      clear(app);
      var today = todayISO();
      var title = h('input', { type: 'text', placeholder: 'Novo hábito (ex.: Ler as escrituras)', maxlength: '120' });
      var area = areaSelect('');
      var target = h('select', { 'aria-label': 'Meta semanal' });
      for (var i = 7; i >= 1; i--) target.appendChild(h('option', { value: String(i) }, i + 'x por semana'));
      append(app, [
        h('h1', null, 'Hábitos'),
        h('p', { class: 'muted' }, 'Marque os dias em que fez. Cada marcação vale XP; desmarcar estorna o XP.'),
        h('section', { class: 'card' },
          list.length ? list.map(function (hb) {
            return h('div', { class: 'habit' },
              h('div', { class: 'habit-name' }, h('strong', null, hb.title),
                h('div', { class: 'small muted' }, (hb.area_name ? hb.area_icon + ' ' + hb.area_name + ' · ' : '') + hb.week_count + '/' + hb.target_per_week + ' nesta semana')),
              h('div', { class: 'dots' }, hb.week.map(function (d) { return habitDot(hb, d, today); })),
              h('button', { class: 'btn btn-sm', title: 'Arquivar hábito', onclick: function () {
                if (confirm('Arquivar o hábito "' + hb.title + '"? O histórico e o XP continuam guardados.')) api('PATCH', '/api/habits/' + hb.id, { active: false }).then(refresh).catch(fail);
              } }, 'Arquivar'));
          }) : h('p', { class: 'empty' }, 'Nenhum hábito ainda. Comece com um ou dois.')),
        h('section', { class: 'card' }, h('h2', null, 'Novo hábito'),
          h('form', { class: 'row', onsubmit: function (e) {
            e.preventDefault();
            if (!title.value.trim()) return;
            api('POST', '/api/habits', { title: title.value, area_id: area.value ? Number(area.value) : null, target_per_week: Number(target.value) })
              .then(function () { toast('Hábito criado'); return refresh(); }).catch(fail);
          } }, h('div', { class: 'grow' }, title), area, target, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Criar'))),
      ]);
    });
  }

  function viewReview(app) {
    return api('GET', '/api/reviews/draft').then(function (d) {
      clear(app);
      var s = d.saved_review || {};
      var vaultOk = state.health && state.health.vault && state.health.vault.ok;
      function ta(name, label, hint) {
        return h('label', { class: 'field' }, h('span', null, label), h('textarea', { name: name, placeholder: hint, value: s[name] || '' }));
      }
      var saveObs = h('input', { type: 'checkbox', checked: vaultOk, disabled: !vaultOk });
      var form = h('form', { onsubmit: function (e) {
        e.preventDefault();
        var f = e.target;
        api('POST', '/api/reviews', {
          week_start: d.week.start, wins: f.wins.value, difficulties: f.difficulties.value,
          lessons: f.lessons.value, next_focus: f.next_focus.value, save_to_obsidian: saveObs.checked,
        }).then(function (r) {
          toast('Revisão salva' + (r.note ? ' (nota: ' + r.note.path + ')' : ''));
          if (r.note_error) toast('Obsidian: ' + r.note_error, 'err');
          return r.xp ? celebrate(r.xp) : null;
        }).then(refresh).catch(fail);
      } },
        ta('wins', 'O que deu certo?', 'Conquistas, mesmo pequenas'),
        ta('difficulties', 'O que travou?', 'Sem culpa: só o que atrapalhou'),
        ta('lessons', 'O que aprendi?', 'Algo para levar adiante'),
        ta('next_focus', 'Foco da próxima semana', 'No máximo 3 coisas'),
        h('label', { class: 'inline small', style: 'margin-bottom:.75rem' }, saveObs, vaultOk ? 'Salvar também no Obsidian (pasta desempenho/)' : 'Obsidian não conectado (veja Ajustes)'),
        h('div', null, h('button', { class: 'btn btn-primary', type: 'submit' }, d.saved_review ? 'Atualizar revisão' : 'Concluir revisão (+XP)')));
      function li(arr, fmt) { return arr.length ? h('ul', null, arr.map(function (x) { return h('li', null, fmt(x)); })) : h('p', { class: 'empty' }, '—'); }
      append(app, [
        h('h1', null, 'Revisão semanal · ' + fmtDay(d.week.start) + ' – ' + fmtDay(d.week.end)),
        d.saved_review ? h('div', { class: 'notice' }, 'Revisão desta semana já registrada em ' + new Date(d.saved_review.updated_at).toLocaleString('pt-BR') + '. Você pode atualizá-la.') : null,
        h('div', { class: 'grid grid-2' },
          h('section', { class: 'card' }, h('h2', null, '✔ Concluído (' + d.done.length + ')'), li(d.done, function (t) { return t.title + (t.area ? ' · ' + t.area : ''); })),
          h('section', { class: 'card' }, h('h2', null, 'Ficou pendente (' + d.still_pending.length + ')'), li(d.still_pending, function (t) { return t.title; }),
            d.overdue.length ? [h('h3', null, 'Prazo vencido'), li(d.overdue, function (t) { return t.title + ' (' + fmtShort(t.due_date) + ')'; })] : null)),
        h('div', { style: 'height:1rem' }),
        h('div', { class: 'grid grid-2' },
          h('section', { class: 'card' }, h('h2', null, 'Números'),
            h('p', null, '+' + d.xp_week + ' XP nesta semana · Nível ' + d.level.level + ' (' + d.level.title + ')'),
            d.habits.length ? li(d.habits, function (x) { return x.title + ': ' + x.done + '/' + x.target; }) : null,
            d.quiet_areas.length ? h('p', { class: 'small muted' }, 'Sem conclusões nesta semana: ' + d.quiet_areas.map(function (q) { return q.area; }).join(', ') + '. Foi uma escolha consciente ou algo ficou esquecido?') : null),
          h('section', { class: 'card' }, h('h2', null, 'Já planejado para a próxima semana'), li(d.next_week_planned, function (t) { return t.title + (t.planned_date ? ' · ' + fmtShort(t.planned_date) : ''); }))),
        h('div', { style: 'height:1rem' }),
        h('section', { class: 'card' }, h('h2', null, 'Reflexão'), form),
      ]);
    });
  }

  function viewProgress(app) {
    return Promise.all([api('GET', '/api/xp'), api('GET', '/api/xp/history?weeks=12'), api('GET', '/api/xp/ledger?limit=100'), api('GET', '/api/seasons')]).then(function (r) {
      var x = r[0], hist = r[1], ledger = r[2], seasons = r[3];
      clear(app);
      var max = Math.max.apply(null, hist.map(function (w) { return Math.abs(w.xp); }).concat([1]));
      var amount = h('input', { type: 'number', placeholder: 'ex.: -10', style: 'width:110px' });
      var note = h('input', { type: 'text', placeholder: 'Motivo (obrigatório)', maxlength: '300' });
      var sName = h('input', { type: 'text', placeholder: 'Nome (ex.: Semestre 2026/2)' });
      var sStart = h('input', { type: 'date', value: todayISO() });
      var sEnd = h('input', { type: 'date', value: addDays(todayISO(), 90) });
      var sGoal = h('input', { type: 'number', placeholder: 'Meta de XP', style: 'width:120px' });
      var cur = seasons.current;
      append(app, [
        h('h1', null, 'Progresso'),
        h('div', { class: 'grid grid-2' },
          h('section', { class: 'card xp-card' },
            h('div', { class: 'xp-total' }, h('b', null, x.total_xp), h('span', null, 'XP acumulado')),
            h('div', null, h('span', { class: 'level-badge' }, 'Nível ' + x.level), ' ', h('strong', null, x.title)),
            h('div', { class: 'bar xp lg' }, h('i', { style: 'width:' + Math.round(x.progress * 100) + '%' })),
            h('div', { class: 'small muted' }, 'Faltam ' + x.xp_to_next + ' XP para o nível ' + (x.level + 1))),
          h('section', { class: 'card' }, h('h2', null, '🏁 Temporada'),
            cur ? [h('p', null, h('strong', null, cur.name), ' · ' + fmtShort(cur.start_date) + ' a ' + fmtShort(cur.end_date)),
              h('p', null, cur.xp + ' XP' + (cur.xp_goal ? ' de ' + cur.xp_goal : '') + ' · ' + plural(cur.days_left, 'dia restante', 'dias restantes')),
              cur.xp_goal ? h('div', { class: 'bar xp' }, h('i', { style: 'width:' + Math.round(cur.progress * 100) + '%' })) : null]
              : [h('p', { class: 'small muted' }, 'Uma temporada é um período (ex.: semestre) com uma meta de XP. Opcional.'),
                h('form', { class: 'row', onsubmit: function (e) {
                  e.preventDefault();
                  api('POST', '/api/seasons', { name: sName.value, start_date: sStart.value, end_date: sEnd.value, xp_goal: Number(sGoal.value || 0) })
                    .then(function () { toast('Temporada criada'); return refresh(); }).catch(fail);
                } }, sName, sStart, sEnd, sGoal, h('button', { class: 'btn', type: 'submit' }, 'Criar'))])),
        h('section', { class: 'card', style: 'margin-top:1rem' }, h('h2', null, 'XP por semana (últimas 12)'),
          h('div', { class: 'chart' }, hist.map(function (w) {
            return h('div', { class: 'col', title: w.week_start + ': ' + w.xp + ' XP' },
              h('em', null, w.xp || ''),
              h('i', { style: 'height:' + Math.round((Math.max(w.xp, 0) / max) * 100) + '%' }),
              h('small', null, fmtDay(w.week_start)));
          }))),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Histórico de XP'), h('span', { class: 'small muted' }, 'Nada é apagado: correções aparecem como lançamentos')),
          h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Quando'), h('th', null, 'Motivo'), h('th', { class: 'num' }, 'XP'))),
            h('tbody', null, ledger.map(function (e) {
              return h('tr', null,
                h('td', null, new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
                h('td', null, (e.task_title || e.habit_title || '') + (e.note ? (e.task_title || e.habit_title ? ' — ' : '') + e.note : '')),
                h('td', { class: 'num ' + (e.amount > 0 ? 'pos' : e.amount < 0 ? 'neg' : '') }, (e.amount > 0 ? '+' : '') + e.amount));
            }))))),
        h('section', { class: 'card' }, h('h2', null, 'Ajuste manual'),
          h('p', { class: 'small muted' }, 'Para corrigir algo. Fica registrado com o motivo e pode ser auditado.'),
          h('form', { class: 'row', onsubmit: function (e) {
            e.preventDefault();
            api('POST', '/api/xp/adjustments', { amount: Number(amount.value), note: note.value }).then(function () { toast('Ajuste registrado'); return refresh(); }).catch(fail);
          } }, amount, h('div', { class: 'grow' }, note), h('button', { class: 'btn', type: 'submit' }, 'Registrar'))),
      ]);
    });
  }

  function viewSettings(app) {
    return Promise.all([api('GET', '/api/areas?all=1'), api('GET', '/api/rules'), api('GET', '/api/health'), api('GET', '/api/backups')]).then(function (r) {
      var areas = r[0], rules = r[1], health = r[2], backups = r[3];
      clear(app);
      var v = health.vault;
      function num(name, val, label) {
        return h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'number', name: name, value: String(val), min: '0' }));
      }
      var rulesForm = h('form', { onsubmit: function (e) {
        e.preventDefault();
        var f = e.target;
        api('PUT', '/api/rules', {
          xp_by_effort: { 1: Number(f.e1.value), 2: Number(f.e2.value), 3: Number(f.e3.value) },
          xp_subtask: Number(f.xp_subtask.value), xp_micro: Number(f.xp_micro.value), granular_daily_cap: Number(f.granular_daily_cap.value),
          xp_habit: Number(f.xp_habit.value), xp_weekly_review: Number(f.xp_weekly_review.value), level_base: Number(f.level_base.value),
        }).then(function () { toast('Regras salvas (valem para os próximos lançamentos)'); return refresh(); }).catch(fail);
      } },
        h('div', { class: 'grid grid-2' },
          num('e1', rules.xp_by_effort[1], 'Tarefa pequena (XP)'), num('e2', rules.xp_by_effort[2], 'Tarefa média (XP)'),
          num('e3', rules.xp_by_effort[3], 'Tarefa grande (XP)'), num('xp_habit', rules.xp_habit, 'Hábito marcado (XP)'),
          num('xp_subtask', rules.xp_subtask, 'Subtarefa (XP)'), num('xp_micro', rules.xp_micro, 'Microtarefa (XP)'),
          num('granular_daily_cap', rules.granular_daily_cap, 'Teto diário de XP de subdivisões'), num('xp_weekly_review', rules.xp_weekly_review, 'Revisão semanal (XP)'),
          num('level_base', rules.level_base, 'Base dos níveis (nível 2 = base)')),
        h('p', { class: 'small muted' }, 'Títulos: ' + rules.titles.map(function (t) { return t.title + ' (nível ' + t.min_level + ')'; }).join(' · ')),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar regras'));

      var tokenInput = h('input', { type: 'password', value: getToken(), placeholder: 'ACCESS_TOKEN' });
      append(app, [
        h('h1', null, 'Ajustes'),
        h('section', { class: 'card' }, h('h2', null, 'Áreas da vida'),
          h('p', { class: 'small muted' }, 'Renomeie, troque ícone/cor ou desative. Áreas não são apagadas para não perder histórico.'),
          h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Ícone'), h('th', null, 'Nome'), h('th', null, 'Cor'), h('th', null, 'Ordem'), h('th', null, 'Ativa'), h('th', null, ''))),
            h('tbody', null, areas.map(function (a) {
              var icon = h('input', { type: 'text', value: a.icon, style: 'width:3.2rem', maxlength: '8' });
              var name = h('input', { type: 'text', value: a.name, maxlength: '60' });
              var color = h('input', { type: 'color', value: a.color });
              var order = h('input', { type: 'number', value: String(a.sort_order), style: 'width:4.5rem' });
              var active = h('input', { type: 'checkbox', checked: !!a.active });
              return h('tr', null, h('td', null, icon), h('td', null, name), h('td', null, color), h('td', null, order), h('td', null, active),
                h('td', null, h('button', { class: 'btn btn-sm', onclick: function () {
                  api('PATCH', '/api/areas/' + a.id, { icon: icon.value, name: name.value, color: color.value, sort_order: Number(order.value), active: active.checked })
                    .then(function () { toast('Área salva'); return loadAreas(); }).catch(fail);
                } }, 'Salvar')));
            })))),
          (function () {
            var n = h('input', { type: 'text', placeholder: 'Nova área', maxlength: '60' });
            var ic = h('input', { type: 'text', placeholder: '🙂', style: 'width:3.2rem', maxlength: '8' });
            return h('form', { class: 'row', style: 'margin-top:.75rem', onsubmit: function (e) {
              e.preventDefault();
              api('POST', '/api/areas', { name: n.value, icon: ic.value }).then(function () { toast('Área criada'); return loadAreas().then(refresh); }).catch(fail);
            } }, ic, h('div', { class: 'grow' }, n), h('button', { class: 'btn', type: 'submit' }, 'Adicionar área'));
          })()),
        h('section', { class: 'card' }, h('h2', null, 'Regras de XP'), rulesForm),
        h('section', { class: 'card' }, h('h2', null, 'Obsidian'),
          v.ok ? [h('p', null, '✔ Conectado: ', h('code', null, v.path)),
            !v.obsidian_detected ? h('p', { class: 'small muted' }, 'Aviso: não encontrei a pasta .obsidian aqui. Confira se este é mesmo o seu vault.') : null,
            h('p', { class: 'small' }, v.folders.map(function (f) { return (f.exists ? '✔ ' : '✖ ') + f.folder + '/'; }).join('   ')),
            v.folders.some(function (f) { return !f.exists; }) ? h('button', { class: 'btn', onclick: function () { api('POST', '/api/notes/init', {}).then(function () { toast('Pastas criadas'); return refresh(); }).catch(fail); } }, 'Criar pastas que faltam') : null]
            : h('div', { class: 'notice' }, 'Não conectado: ' + v.reason + ' Defina OBSIDIAN_VAULT_PATH no arquivo .env e reinicie o painel. Passo a passo em docs/INTEGRATIONS.md.')),
        h('section', { class: 'card' }, h('h2', null, 'Backup'),
          h('p', { class: 'small muted' }, 'Pasta: ', h('code', null, backups.dir), '. O painel faz um backup automático por dia enquanto está aberto.'),
          h('button', { class: 'btn btn-primary', onclick: function (e) {
            e.target.disabled = true;
            api('POST', '/api/backups', {}).then(function (b) { toast('Backup criado: ' + b.file); return refresh(); }).catch(fail);
          } }, 'Fazer backup agora'),
          backups.backups.length ? h('ul', { class: 'small' }, backups.backups.slice(0, 8).map(function (b) {
            return h('li', null, b.file + ' · ' + Math.round(b.size / 1024) + ' KB');
          })) : h('p', { class: 'empty' }, 'Nenhum backup ainda.')),
        h('section', { class: 'card' }, h('h2', null, 'Acesso'),
          h('p', { class: 'small muted' }, health.auth_required ? 'Este painel exige senha (ACCESS_TOKEN). Ela fica guardada só neste navegador.' : 'Sem senha: o painel só aceita acessos deste computador.'),
          health.auth_required ? h('form', { class: 'row', onsubmit: function (e) { e.preventDefault(); setToken(tokenInput.value); toast('Senha salva neste navegador'); } },
            h('div', { class: 'grow' }, tokenInput), h('button', { class: 'btn', type: 'submit' }, 'Salvar')) : null,
          h('p', { class: 'small muted' }, 'Versão ' + health.version + ' · fuso ' + health.timezone)),
      ]);
    });
  }

  // ---------- detalhe da tarefa (janela) ----------
  function openTask(id) {
    var root = document.getElementById('modal-root');
    function close() { clear(root); document.removeEventListener('keydown', onKey); refresh(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    function load() {
      return Promise.all([api('GET', '/api/tasks/' + id), api('GET', '/api/plan/project'), api('GET', '/api/plan/goal')]).then(function (res) {
        var t = res[0];
        function linkSelect(items, value, emptyLabel) {
          var sel = h('select', null, h('option', { value: '' }, emptyLabel));
          items.filter(function (x) { return x.status === 'active' || x.id === value; }).forEach(function (x) {
            var area = state.areas.filter(function (a) { return a.id === x.area_id; })[0];
            sel.appendChild(h('option', { value: String(x.id) }, (area ? area.icon + ' ' : '') + x.title));
          });
          sel.value = value ? String(value) : '';
          return sel;
        }
        var f = {
          project: linkSelect(res[1], t.project_id, 'Nenhum projeto'),
          goal: linkSelect(res[2], t.goal_id, 'Nenhuma meta'),
          title: h('input', { type: 'text', value: t.title, maxlength: '300' }),
          area: areaSelect(t.area_id),
          planned: h('input', { type: 'date', value: t.planned_date || '' }),
          due: h('input', { type: 'date', value: t.due_date || '' }),
          effort: h('select', null, [[1, 'Pequena'], [2, 'Média'], [3, 'Grande']].map(function (e) { var o = h('option', { value: String(e[0]) }, e[1]); if (t.effort === e[0]) o.selected = true; return o; })),
          prio: h('input', { type: 'checkbox', checked: t.is_priority }),
          notes: h('textarea', { value: t.notes }),
        };
        var steps = h('textarea', { placeholder: 'Um passo por linha. Ex.:\nAbrir o material\nLer páginas 1 a 10\nFazer 5 exercícios', style: 'min-height:90px' });
        var subTitle = h('input', { type: 'text', placeholder: 'Nova subdivisão…' });
        var canSplit = t.granularity !== 'micro' && t.status === 'pending';
        var modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { class: 'modal-head' },
            h('div', null,
              t.ancestors.length ? h('div', { class: 'crumbs' }, t.ancestors.map(function (a) { return a.title; }).join(' › ')) : null,
              h('h2', null, (t.status === 'done' ? '✔ ' : t.status === 'cancelled' ? '✖ ' : '') + t.title),
              h('div', { class: 'small muted' }, ({ task: 'Tarefa', subtask: 'Subtarefa', micro: 'Microtarefa' })[t.granularity] + ' #' + t.id + (t.project ? ' · projeto: ' + t.project.title : '') + (t.goal ? ' · meta: ' + t.goal.title : ''))),
            h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, '✕')),
          h('form', { onsubmit: function (e) {
            e.preventDefault();
            api('PATCH', '/api/tasks/' + id, {
              title: f.title.value, area_id: f.area.value ? Number(f.area.value) : null, planned_date: f.planned.value || null,
              due_date: f.due.value || null, effort: Number(f.effort.value), is_priority: f.prio.checked, notes: f.notes.value,
              project_id: f.project.value ? Number(f.project.value) : null, goal_id: f.goal.value ? Number(f.goal.value) : null,
            }).then(function () { toast('Salvo'); return load(); }).catch(fail);
          } },
            h('label', { class: 'field' }, h('span', null, 'Título'), f.title),
            h('div', { class: 'grid grid-2', style: 'gap:.5rem' },
              h('label', { class: 'field' }, h('span', null, 'Área'), f.area),
              h('label', { class: 'field' }, h('span', null, 'Tamanho (define o XP)'), f.effort),
              h('label', { class: 'field' }, h('span', null, 'Data planejada (quando vou fazer)'), f.planned),
              h('label', { class: 'field' }, h('span', null, 'Prazo (até quando precisa estar pronto)'), f.due),
              t.parent_id ? null : h('label', { class: 'field' }, h('span', null, 'Projeto'), f.project),
              t.parent_id ? null : h('label', { class: 'field' }, h('span', null, 'Meta'), f.goal)),
            h('label', { class: 'inline', style: 'margin-bottom:.6rem' }, f.prio, '⭐ Prioridade'),
            h('label', { class: 'field' }, h('span', null, 'Observações'), f.notes),
            h('div', { class: 'row' },
              h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar'),
              t.status !== 'cancelled' ? h('button', { class: 'btn', type: 'button', onclick: function () { toggleTask(t).then(load).catch(fail); } }, t.status === 'done' ? 'Reabrir' : '✔ Concluir') :
                h('button', { class: 'btn', type: 'button', onclick: function () { api('POST', '/api/tasks/' + id + '/reopen', {}).then(load).catch(fail); } }, 'Reativar'),
              t.status === 'pending' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
                if (confirm('Cancelar esta tarefa? Ela não é apagada: fica no histórico como cancelada.')) api('POST', '/api/tasks/' + id + '/cancel', {}).then(load).catch(fail);
              } }, 'Cancelar tarefa') : null)),
          h('hr', { style: 'border:none;border-top:1px solid var(--border);margin:1rem 0' }),
          h('h3', null, 'Subdivisões'),
          t.children.length ? h('ul', { class: 'task-list' }, t.children.map(function (c) {
            return taskRow(c, { hideArea: true, noStar: true, afterToggle: load, onOpen: function (cid) { id = cid; load(); } });
          })) : h('p', { class: 'empty' }, 'Nenhuma ainda.'),
          canSplit ? h('form', { class: 'row', style: 'margin-top:.5rem', onsubmit: function (e) {
            e.preventDefault();
            if (!subTitle.value.trim()) return;
            api('POST', '/api/tasks', { title: subTitle.value, parent_id: id }).then(load).catch(fail);
          } }, h('div', { class: 'grow' }, subTitle), h('button', { class: 'btn', type: 'submit' }, 'Adicionar')) : null,
          canSplit ? h('details', { class: 'section' }, h('summary', null, 'Dividir em vários passos de uma vez'),
            h('p', { class: 'small muted' }, 'Passos pequenos e concretos facilitam começar. Subdivisões valem pouco XP de propósito: o XP principal vem da tarefa.'),
            steps, h('button', { class: 'btn', style: 'margin-top:.5rem', onclick: function () {
              var lines = steps.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
              if (!lines.length) return;
              api('POST', '/api/tasks/' + id + '/split', { steps: lines }).then(function () { toast(plural(lines.length, 'passo criado', 'passos criados')); return load(); }).catch(fail);
            } }, 'Criar passos')) : null,
          h('details', { class: 'section' }, h('summary', null, 'Histórico e XP desta tarefa'),
            h('ul', { class: 'small' },
              t.history.map(function (x) { return h('li', null, new Date(x.at).toLocaleString('pt-BR') + ' · ' + actionName(x.action) + ' (' + x.source + ')'); }),
              t.xp_entries.map(function (e) { return h('li', null, new Date(e.created_at).toLocaleString('pt-BR') + ' · ' + (e.amount > 0 ? '+' : '') + e.amount + ' XP · ' + e.note); }))));
        clear(root);
        root.appendChild(h('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === e.currentTarget) close(); } }, modal));
      }).catch(fail);
    }
    load();
  }
  function actionName(a) {
    return ({ created: 'criada', updated: 'editada', completed: 'concluída', reopened: 'reaberta', cancelled: 'cancelada' })[a] || a;
  }

  // ---------- acesso com senha ----------
  function showLogin() {
    var app = document.getElementById('app');
    clear(app);
    var input = h('input', { type: 'password', placeholder: 'Senha de acesso (ACCESS_TOKEN)', autocomplete: 'current-password' });
    append(app, h('section', { class: 'card', style: 'max-width:420px;margin:10vh auto' },
      h('h1', null, 'Entrar'),
      h('p', { class: 'muted small' }, 'Este painel está protegido por senha. Ela fica salva só neste navegador.'),
      h('form', { class: 'row', onsubmit: function (e) { e.preventDefault(); setToken(input.value); route(); } },
        h('div', { class: 'grow' }, input), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar'))));
    input.focus();
  }

  // ---------- roteamento ----------
  function loadAreas() {
    return api('GET', '/api/areas').then(function (a) { state.areas = a; });
  }
  function route() {
    var app = document.getElementById('app');
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/');
    var name = parts[0] || 'semana';
    var navName = name === 'area' ? 'areas' : name;
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      a.className = a.getAttribute('data-route') === navName ? 'active' : '';
    });
    var views = {
      semana: function () { return viewWeek(app, parts[1]); },
      areas: function () { return viewAreas(app); },
      area: function () { return viewArea(app, parts[1]); },
      habitos: function () { return viewHabits(app); },
      revisao: function () { return viewReview(app); },
      progresso: function () { return viewProgress(app); },
      ajustes: function () { return viewSettings(app); },
    };
    var fn = views[name] || views.semana;
    current.render = function (keepScroll) {
      var y = window.pageYOffset;
      return fn().then(function () { if (keepScroll) window.scrollTo(0, y); });
    };
    return api('GET', '/api/health').then(function (hl) {
      state.health = hl;
      return state.areas.length ? null : loadAreas();
    }).then(function () { return current.render(false); }).catch(function (err) {
      if (err.message !== 'Não autorizado' && err.message.indexOf('autorizado') === -1) {
        clear(app);
        append(app, h('div', { class: 'card' }, h('h2', null, 'Não consegui carregar'), h('p', null, err.message), h('button', { class: 'btn', onclick: route }, 'Tentar de novo')));
      }
    });
  }

  document.getElementById('fullscreen').addEventListener('click', function () {
    var d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (d.requestFullscreen || d.webkitRequestFullscreen) {
      (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
    } else {
      toast('Use F11 (Windows) ou "Adicionar à Tela de Início" (iPhone)');
    }
  });
  window.addEventListener('hashchange', route);
  // Atualiza ao voltar para a aba (ex.: depois de usar o Jarvis no Telegram).
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !document.getElementById('modal-root').firstChild) refresh(); });
  route();
})();
