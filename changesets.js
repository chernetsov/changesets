Changesets = {

  op: function(op) {
    op = _.clone(op)
    op.len = op.text ? op.text.length : 0

    op.toString = function() {
      return this.type + this.pos + ':' + this.text
    }

    op.extend = function(mod) {
      op = _.extend(_.clone(this), mod)
      op.len = op.text.length
      return op
    }

    op.apply = function(text, selection) {
      if (this.type == '+') {
        if (text.length != this.tlen) throw new Error('Text length doesn\'t match expected length. It\'s most likely you have missed a transformation: expected:' + this.tlen + ', actual:' + text.length)

        if(selection) {
          if(this.pos < selection.b) selection.b += this.text.length
          if(this.pos < selection.e) selection.e += this.text.length
        }

        return text.slice(0, this.pos) + this.text + text.slice(this.pos)
      }
      else if (this.type == '-') {
        if (text.length != this.tlen) throw new Error('Text length doesn\'t match expected length. It\'s most likely you have missed a transformation: expected:' + this.tlen + ', actual:' + text.length)
        if (text.substr(this.pos, this.len) != this.text) throw new Error('Applying delete operation: Passed context doesn\'t match assumed context: ' + JSON.stringify(op) + ', actual context: "' + text.substr(this.pos, this.len) + '"')

        if(selection) {
          if(this.pos < selection.b) selection.b -= Math.min(this.text.length, selection.b - this.pos)
          if(this.pos < selection.e) selection.e -= Math.min(this.text.length, selection.e - this.pos)
        }

        return text.slice(0, this.pos) + text.slice(this.pos + this.len)
      }
      else if (this.type == '=') {
        return text
      }
    }

    op.transformAgainst = function(b) {
      if (this.type == '+' && b.type == '+') {
        var tlen = this.tlen + b.len
        // 'abc' =>  0:+x('xabc') | 3:+x('abcx')
        // 'xabcx'
        if (this.pos < b.pos) {
          return this.extend({
            tlen: tlen
          })
        }
        // 'abc'=>   1:+x('axbc') | 1:+y('aybc')
        // 'ayxbc'  -- depends on the accessory (the tie breaker)
        if (this.pos == b.pos && this.accessory < b.accessory) {
          return this.extend({
            tlen: tlen
          })
        }
        // 'abc'=>   1:+x('axbc') | 0:+x('xabc')
        // 'xaxbc'
        if (b.pos <= this.pos) {
          return this.extend({
            tlen: tlen,
            pos: this.pos + b.len
          })
        }
      }
      else if (this.type == '+' && b.type == '-') {
        var tlen = this.tlen - b.len
        // 'abc'=>  1:+x('axbc') | 2:-1('ab')
        // 'axb'
        if (this.pos < b.pos) {
          return this.extend({
            tlen: tlen
          })
        }
        // 'abc'=>  1:+x('axbc') | 1:-1('ac')
        // 'axb'
        if (this.pos == b.pos) {
          return this.extend({
            tlen: tlen
          })
        }
        //'abc'=> 2:+x('abxc') | 0:-2('c')
        //'xc'
        if (b.pos < this.pos) {
          // Shift this back by `b.len`, but not more than `b.pos`
          return this.extend({
            tlen: tlen,
            pos: Math.max(this.pos - b.len, b.pos)
          })
        }
      }
      else if (this.type == '-' && b.type == '-') {
        var tlen = this.tlen - b.len
        // 'abc' =>  0:-2('c') | 1:-1('ac')
        // 'c'
        if (this.pos < b.pos) {
          // if the other operation already deleted some of the characters
          // in my range, don't delete them again!
          var startOfOther = Math.min(b.pos - this.pos, this.len)
          return this.extend({
            tlen: tlen,
            text: this.text.substr(0, startOfOther) + this.text.substr(startOfOther + b.len)
          })
        }
        // 'abc'=>   1:-1('ac') | 1:-2('a')
        // 'a'
        if (this.pos == b.pos) {
          // if the other operation already deleted some the characters
          // in my range, don't delete them again!
          if (this.len <= b.len) return Changesets.op({
            type: '='
          })
          // the other deletion's range is shorter than mine
          return this.extend({
            tlen: tlen,
            text: this.text.substr(b.len)
          })
        }
        // 'abcd'=>   2:-1('abd') | 0:-3('d')
        // 'd'
        if (b.pos < this.pos) {
          var overlap = b.pos + b.len - this.pos // overlap of `change`, starting at `this.pos`
          if (overlap >= this.len) return Changesets.op({
            type: '='
          })
          if (overlap > 0) return this.extend({
            tlen: tlen,
            pos: b.pos,
            text: this.text.substr(overlap)
          })
          return this.extend({
            tlen: tlen,
            pos: this.pos - b.len
          })
        }
      }
      else if (this.type == '-' && b.type == '+') {
        var tlen = this.tlen + b.len
        // 'abc' =>  0:-1('bc') | 3:+x('abcx')
        // 'bcx'
        if (this.pos < b.pos) {
          if (this.pos + this.len > b.pos) {
            // An insert is done within our deletion range
            // -> split it in to
            var firstHalfLength = b.pos - this.pos
            return [
              this.extend({
                tlen: tlen,
                text: this.text.substr(0, firstHalfLength)
              }),
              this.extend({
                tlen: tlen,
                pos: b.pos + b.len,
                text: this.text.substr(firstHalfLength)
              })
            ]
          }
          return this.extend({
            tlen: tlen
          })
        }
        // 'abc'=>   1:-1('ac') | 1:+x('axbc')
        // 'axc'
        if (this.pos == b.pos) {
          return this.extend({
            tlen: tlen,
            pos: this.pos + b.len
          })
        }
        // 'abc'=>   2:-1('ab') | 0:+x('xabc')
        // 'xab'
        if (b.pos < this.pos) {
          return this.extend({
            tlen: tlen,
            pos: this.pos + b.len
          })
        }
      }

      return this
    }

    return op
  },

  cs: function(cs) {
    cs = _.clone(cs.map(function(op) {
      return _.clone(op)
    }))

    cs.toString = function() {
      return this.map(function(op) {
        return op.toString()
      }).join(' ')
    }

    cs.push = function(op) {
      if (op instanceof Array) {
        op.forEach(function(op) {
          [].push.call(cs, op)
        })
      } else {
        [].push.call(cs, op)
      }
    }

    cs.apply = function(text, selection) {
      this.sequencify().forEach(function(op) {
        text = op.apply(text, selection)
      })
      return text
    }

    cs.transformAgainst = function(b) {
      var newCs = Changesets.cs([]),
        b = b.sequencify()

        this.forEach(function(op) {
          b.forEach(function(o) {
            op = op.transformAgainst(o)
          })
          newCs.push(op)
        })

        return newCs
    }

    cs.sequencify = function(cs) {
      var result = Changesets.cs([])
      this.forEach(function(op) {
        if (op.type == '=') return
        // transform against all previous ops
        result.forEach(function(o) {
          op = op.transformAgainst(o)
        })
        // ... and add it on top of them
        result.push(op)
      })
      return result
    }

    cs.pack = function() {
      return this.filter(function(op) {
        return op.type != '='
      }).map(function(op) {
        var text = op.text.replace(/%/g, '%25').replace(/:/g, '%3A'),
          pos = (op.pos).toString(36),
          tlen = (op.tlen).toString(36),
          accessory = (op.accessory).toString(36)
          return op.type + pos + ':' + tlen + ':' + text + ':' + accessory
      }).join('')
    }

    return cs
  },

  diff: function(oldText, newText, accessory) {
    accessory = accessory || 0
    var diff = textdiff(oldText, newText),
      cs = Changesets.cs([]),
      tlen = oldText.length

    if (diff.oldFragment) {
      cs.push(Changesets.op({
        type: '-',
        tlen: tlen,
        pos: diff.from,
        text: diff.oldFragment,
        accessory: accessory
      }))
    }
    if (diff.newFragment) {
      cs.push(Changesets.op({
        type: '+',
        tlen: tlen,
        pos: diff.from,
        text: diff.newFragment,
        accessory: accessory
      }))
    }

    return cs
  },

  unpack: function(packed) {
    if (packed == '') return Changesets.cs([])
    var matches = packed.match(/(\+|-)\w+?:\w+?:[^:]+?:\w+/g)
    if (!matches) throw new Error('Cannot unpack invalid serialized changeset string')

    return Changesets.cs(matches.map(function(s) {
      var props = s.substr(1).split(':')
      return Changesets.op({
        type: s.substr(0, 1),
        pos: parseInt(props[0], 36),
        tlen: parseInt(props[1], 36),
        text: props[2].replace(/%3A/gi, ':').replace(/%25/g, '%'),
        accessory: parseInt(props[3], 36)
      })
    }))
  }
}
