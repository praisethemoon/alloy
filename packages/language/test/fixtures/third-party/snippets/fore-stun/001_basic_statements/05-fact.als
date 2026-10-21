fact {
  first.state = On
  no last.event

  all t : Trace - last, t" : t.next {
    some e : Event {
      t.event = e 
      t".state = transitions[t.state][t.event]
    }
  }
}
